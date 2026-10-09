import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { budgetStatus, reserveBudget } from '../src/budget.mjs';

const root = path.resolve(process.env.NEBIUS_BUDGET_RUNTIME_DIR || 'temp/dockproof-budget');
process.env.NEBIUS_BUDGET_RUNTIME_DIR = root;
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(root, 'test-'));
const model = 'nvidia/test-budget-model';
const request = { model, messages: [{ role: 'user', content: 'Freight evidence: 货物' }], max_tokens: 100 };
const config = { version: 1, model, inputUsdPerMillion: 0.12, outputUsdPerMillion: 0.3,
  approvedUsd: 0.01, confirmedCreditsUsd: 1, creditReserveUsd: 0.9,
  expiresAt: '2099-01-01T00:00:00Z', maxOutputTokens: 100, reservedMicroUsd: 0, requests: 0 };
let sequence = 0;
function fixture(overrides = {}) {
  const file = path.join(run, `budget-${++sequence}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...config, ...overrides }), { mode: 0o600 });
  return file;
}

test('missing, corrupt, expired, zero and credit-overrun approvals stop requests', () => {
  assert.equal(budgetStatus({ file: '' }).ready, false);
  assert.throws(() => reserveBudget({ file: path.join(run, 'missing'), model, request }), { code: 'budget_file' });
  const corrupt = fixture(); fs.writeFileSync(corrupt, '{broken');
  assert.equal(budgetStatus({ file: corrupt }).code, 'budget_file');
  for (const [overrides, code] of [
    [{ expiresAt: '2000-01-01T00:00:00Z' }, 'budget_expired'],
    [{ approvedUsd: 0 }, 'budget_reached'],
    [{ approvedUsd: 0.2 }, 'budget_credit_limit'],
    [{ reservedMicroUsd: -1 }, 'budget_invalid'],
  ]) {
    const file = fixture(overrides);
    assert.equal(budgetStatus({ file }).ready, false);
    assert.throws(() => reserveBudget({ file, model, request }), { code });
  }
});

test('UTF-8 plus overhead and output ceilings reserve rounded microUSD durably', () => {
  const file = fixture();
  const reservation = reserveBudget({ file, model, request });
  const input = Buffer.byteLength(JSON.stringify(request), 'utf8') + 4096;
  const expected = Math.ceil(input * 0.12) + Math.ceil(100 * 0.3);
  assert.equal(reservation.inputTokenUpperBound, input);
  assert.equal(reservation.reservedMicroUsd, expected);
  assert.equal(reservation.requestJson, JSON.stringify(request));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const retained = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(retained.reservedMicroUsd, expected);
  assert.equal(retained.requests, 1);
  assert.equal(budgetStatus({ file }).reservedMicroUsd, expected);
  // A provider failure keeps this reservation; the next request consumes a new one.
  const second = reserveBudget({ file, model, request });
  assert.equal(second.totalReservedMicroUsd, 2 * expected);
  assert.equal(second.reservationId, 2);
});

test('model and output changes stop before the ledger changes', () => {
  const file = fixture();
  assert.throws(() => reserveBudget({ file, model: 'other', request }), { code: 'budget_model' });
  for (const change of [{ max_tokens: 0 }, { max_tokens: 101 }, { max_tokens: 1.5 }, { n: 2 }, { max_completion_tokens: 500 }]) {
    assert.throws(() => reserveBudget({ file, model, request: { ...request, ...change } }), { code: 'budget_output_limit' });
  }
  assert.equal(budgetStatus({ file }).requests, 0);
});

test('an exact cap is persisted and the following request stops at 429', () => {
  const probe = reserveBudget({ file: fixture(), model, request });
  const file = fixture({ approvedUsd: probe.reservedMicroUsd / 1_000_000 });
  assert.equal(reserveBudget({ file, model, request }).remainingMicroUsd, 0);
  assert.equal(budgetStatus({ file }).code, 'budget_reached');
  assert.throws(() => reserveBudget({ file, model, request }), { code: 'budget_reached', status: 429 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).requests, 1);
});

test('separate concurrent processes share one cap and retain the result after restart', async () => {
  const probe = reserveBudget({ file: fixture(), model, request });
  const file = fixture({ approvedUsd: probe.reservedMicroUsd / 1_000_000 });
  const moduleUrl = new URL('../src/budget.mjs', import.meta.url).href;
  const code = `import {reserveBudget} from ${JSON.stringify(moduleUrl)};try {reserveBudget(${JSON.stringify({ file, model, request })});process.stdout.write('reserved');} catch(e) {process.stdout.write(e.code);}`;
  const child = () => new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    process.stdout.on('data', chunk => { out += chunk; });
    process.stderr.on('data', chunk => { err += chunk; });
    process.on('error', reject);
    process.on('close', status => status === 0 ? resolve(out) : reject(new Error(err)));
  });
  const outcomes = await Promise.all([child(), child(), child()]);
  assert.equal(outcomes.filter(value => value === 'reserved').length, 1);
  assert.ok(outcomes.every(value => ['reserved', 'budget_busy', 'budget_reached'].includes(value)));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).requests, 1);
  assert.equal(await child(), 'budget_reached');
});
