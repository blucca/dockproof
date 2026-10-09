import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_MODEL, extractFacts } from './nebius.mjs';
import { budgetStatus } from './budget.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.pdf':'application/pdf', '.wasm':'application/wasm', '.gz':'application/gzip', '.mp4':'video/mp4', '.vtt':'text/vtt; charset=utf-8', '.zip':'application/zip' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(value)); };

function hasAccess(req, token) {
  if (!token) return true;
  const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 400000) throw Object.assign(new Error('Use a document payload under 400 KB.'), { status:413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Supply a JSON document payload.'), { status:400 }); }
}

export function createDockproofServer(options = {}) {
  const env = options.env || process.env;
  const extract = options.extract || extractFacts;
  const status = options.budgetStatus || budgetStatus;
  const token = env.DOCKPROOF_ACCESS_TOKEN || '';
  let activeExtraction = false;
  return http.createServer(async (req,res) => {
  try {
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res,200,{ok:true,product:'DockProof',version:'0.5.0'});
    }
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const budget = status();
      const authorized = hasAccess(req,token);
      return json(res, 200, { product:'DockProof', model:env.NEBIUS_MODEL || DEFAULT_MODEL,
        extractionReady:authorized && Boolean(env.NEBIUS_API_KEY) && budget.ready,
        access:{required:Boolean(token),authorized,endsAt:env.DOCKPROOF_EVALUATION_END || null},
        budget:authorized ? {ready:budget.ready,code:budget.code,message:budget.message} : {ready:false,code:'evaluation_access',message:'Enter the evaluation access code from the testing instructions.'},
        storage:'browser-local' });
    }
    if (url.pathname === '/api/extract' && req.method === 'POST') {
      if (!hasAccess(req,token)) return json(res,401,{error:'Enter the evaluation access code from the testing instructions.',code:'evaluation_access'});
      const origin = req.headers.origin;
      if (origin && origin !== env.DOCKPROOF_ORIGIN && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        return json(res,403,{error:'Use the extraction endpoint from this DockProof application.'});
      }
      if (activeExtraction) return json(res,429,{error:'One extraction is running. Retry when it finishes.'});
      activeExtraction = true;
      try {
        const body = await readJson(req);
        return json(res,200,await extract(body.documents));
      }
      finally { activeExtraction = false; }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Use GET for this resource.'});
    const relative = decodeURIComponent(url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname).replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root)) return json(res,404,{error:'Resource missing.'});
    let data;
    try { data = await readFile(target); }
    catch { return json(res,404,{error:'Resource missing.'}); }
    if (target === path.join(root,'index.html')) {
      data = Buffer.from(data.toString('utf8').replace('<head>', '<head>\n  <meta name="dockproof-api" content="/api">'));
    }
    res.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    json(res, error.status || 500, { error:error.status ? error.message : 'The request failed. Retry the extraction or use source-linked selection.', code:error.code || 'request_failed' });
  }
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4318);
  const server = createDockproofServer();
  server.listen(port,host,() => process.stdout.write(`DockProof listening at http://${host}:${server.address().port}\n`));
}
