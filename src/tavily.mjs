import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { POLICY_VERSION, SUPPORTED_CLASSES, TARIFF_URL, officialSourceUrl } from '../web/core/case-engine.mjs';

const fail = (message, code, status = 503) => Object.assign(new Error(message), { code, status });
const TOPICS = {
  liability: 'XPO "CNWY 199-AK.3" effective August 17 2026 Item 25 cargo liability individual damaged piece weight',
  filing: 'XPO freight damage claim filing required documents nine months carrier receipt 49 CFR 1005.2',
  discounts: '49 CFR 1005.4 supporting invoice trade discounts allowances deductions freight damage claim',
};

function credentials(env) {
  try {
    const key = env.TAVILY_API_KEY || (env.TAVILY_API_KEY_FILE && fs.readFileSync(env.TAVILY_API_KEY_FILE, 'utf8').trim());
    if (typeof key !== 'string' || !key.trim()) throw new Error('key');
    return key.trim();
  } catch { throw fail('Configure the server’s Tavily key to search official sources.', 'rule_setup'); }
}

function readBudget(env) {
  let file, config;
  try {
    file = fs.realpathSync(env.TAVILY_BUDGET_FILE || '');
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { throw fail('Configure a private Tavily credit budget to enable source searches.', 'rule_budget_setup'); }
  if (config?.version !== 1 || !Number.isSafeInteger(config.approvedCredits) || config.approvedCredits < 0
    || !Number.isSafeInteger(config.reservedCredits) || config.reservedCredits < 0
    || config.reservedCredits > config.approvedCredits
    || !Number.isSafeInteger(config.freeReserveCredits) || config.freeReserveCredits < 1
    || config.approvedCredits + config.freeReserveCredits > 1000
    || typeof config.expiresAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(config.expiresAt)
    || !Number.isFinite(Date.parse(config.expiresAt))) {
    throw fail('Review the private Tavily credit budget configuration.', 'rule_budget_invalid');
  }
  if (Date.parse(config.expiresAt) <= Date.now()) throw fail('Source-search approval expired. Renew the private credit budget.', 'rule_budget_expired');
  if (config.reservedCredits >= config.approvedCredits) throw fail('The approved source-search allowance is used. Review the private credit budget.', 'rule_budget_reached', 429);
  return { file, config };
}

export function tavilyStatus({ env = process.env } = {}) {
  try {
    credentials(env); readBudget(env);
    return { ready: true, code: 'rule_search_ready', message: 'Tavily is connected for official-source searches.' };
  } catch (error) { return { ready: false, code: error.code || 'rule_setup', message: error.message }; }
}

function searchInput(input) {
  if (!input || Array.isArray(input) || !Object.hasOwn(TOPICS, input.topic)
    || (input.serviceType != null && !['standard_tariff', 'spot_quote'].includes(input.serviceType))
    || (input.freightClass != null && !SUPPORTED_CLASSES.includes(input.freightClass))) {
    throw fail('Choose a source topic and supported shipment terms.', 'rule_input', 400);
  }
  const scope = { serviceType: input.serviceType ?? null, freightClass: input.freightClass ?? null };
  const terms = input.topic === 'liability'
    ? `${scope.serviceType ? ` ${scope.serviceType === 'spot_quote' ? 'spot quote' : 'standard tariff'}` : ''}${scope.freightClass ? ` class ${scope.freightClass}` : ''}` : '';
  return { topic: input.topic, scope, query: TOPICS[input.topic] + terms };
}

async function request(endpoint, key, fetchImpl, body) {
  let response;
  try {
    response = await fetchImpl(`https://api.tavily.com/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error',
    });
  } catch { throw fail('The source-search connection failed. Retry when the connection returns.', 'rule_connection'); }
  if (!response.ok) throw fail(`Tavily ${endpoint} returned HTTP ${response.status}. Review the server connection.`, 'rule_provider');
  try { return await response.json(); }
  catch { throw fail('Tavily returned an unreadable response. Retry the source search.', 'rule_response'); }
}

function officialResult(result) {
  try {
    const safe = officialSourceUrl(result.url);
    if (!safe) return null;
    const url = new URL(safe);
    const relationship = url.hostname.endsWith('xpo.com') && url.pathname === new URL(TARIFF_URL).pathname ? 'pinned_tariff'
      : /CNWY[^/]*\.pdf$/i.test(url.pathname) ? 'other_tariff' : 'official_guidance';
    return { title: String(result.title || url.hostname).slice(0, 240), url: url.href,
      excerpt: String(result.content || '').slice(0, 800), relationship };
  } catch { return null; }
}

async function checkTariffLibrary(fetchImpl) {
  const url = 'https://www.xpo.com/tariff-library/';
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length')) > 2000000) throw new Error('response');
    const source = await response.text();
    if (source.length > 2000000) throw new Error('size');
    const decoded = source.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
    const links = [...decoded.matchAll(/(?:href\s*=\s*|["']href["']\s*:\s*)["']([^"']+)["']/gi)]
      .map(match => officialSourceUrl(new URL(match[1], url).href)).filter(Boolean);
    const tariffs = [...new Set(links.filter(link => /CNWY[_%\s-]*199[^/]*\.pdf$/i.test(new URL(link).pathname)
      && !/tri[-_]?fold/i.test(link)))].slice(0, 8);
    const pinnedListed = tariffs.some(link => new URL(link).pathname === new URL(TARIFF_URL).pathname);
    return { url, checkedAt, status: tariffs.length ? (pinnedListed ? 'pinned_listed' : 'different_listed') : 'unavailable', tariffs };
  } catch { return { url, checkedAt, status: 'unavailable', tariffs: [] }; }
}

/** One basic search, reserved durably before HTTP; shipment identifiers stay in the browser. */
export async function searchOfficialRules(input, { env = process.env, fetchImpl = fetch } = {}) {
  const { topic, scope, query } = searchInput(input);
  const key = credentials(env);
  const { file } = readBudget(env);
  const runtime = path.resolve(env.TAVILY_BUDGET_RUNTIME_DIR || path.join(process.cwd(), 'temp/dockproof-tavily'));
  const name = createHash('sha256').update(file).digest('hex');
  const lock = path.join(runtime, name + '.lock');
  let lockFd, staging;
  try {
    fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
    lockFd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lock); }
    throw fail(error.code === 'EEXIST' ? 'A source search is active. Retry when it finishes.' : 'Restore the private search runtime directory.', 'rule_budget_lock', 409);
  }
  try {
    // ponytail: a single account lock covers quota check and search; split by account if deployments grow.
    const usage = await request('usage', key, fetchImpl);
    const { config } = readBudget(env);
    const account = usage?.account;
    if (account?.current_plan !== 'Researcher' || account.plan_limit !== 1000
      || !Number.isSafeInteger(account.plan_usage) || account.plan_usage < 0
      || account.paygo_usage !== 0
      || account.plan_limit - account.plan_usage <= config.freeReserveCredits) {
      throw fail('Source search stopped at the free-credit boundary. Review the Tavily account allowance.', 'rule_free_limit', 429);
    }
    const next = { ...config, reservedCredits: config.reservedCredits + 1, lastReservedAt: new Date().toISOString() };
    staging = path.join(runtime, `${name}.${randomUUID()}.json`);
    const fd = fs.openSync(staging, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(next, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(staging, file); staging = undefined;
    const dirFd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }

    const response = await request('search', key, fetchImpl, {
      query, topic: 'general', search_depth: 'basic', max_results: 5,
      include_domains: topic === 'discounts' ? ['ecfr.gov'] : ['xpo.com', 'ecfr.gov'],
      include_domains_mode: 'restrict', include_answer: false, include_raw_content: false,
      auto_parameters: false, include_usage: true,
    });
    if (!Array.isArray(response.results)) throw fail('Tavily returned an incomplete source list. Retry the source search.', 'rule_response');
    const seen = new Set();
    const results = response.results.slice(0, 5).map(officialResult).filter(result => {
      if (!result || seen.has(result.url)) return false;
      seen.add(result.url); return true;
    });
    const library = topic === 'discounts' ? null : await checkTariffLibrary(fetchImpl);
    return { schema: 'dockproof-rule-research/v1', provider: 'Tavily', mode: 'live',
      queriedAt: new Date().toISOString(), topic, query, policyVersion: POLICY_VERSION, scope,
      requestId: typeof response.request_id === 'string' ? response.request_id.slice(0, 120) : null, library, results };
  } catch (error) {
    if (error.status) throw error;
    throw fail('Source search stopped while saving its credit reservation. Restore the private budget before retrying.', 'rule_budget_write');
  } finally {
    if (staging) { try { fs.unlinkSync(staging); } catch {} }
    fs.closeSync(lockFd); fs.unlinkSync(lock);
  }
}
