import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, extractFacts } from './nebius.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4318);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8', '.png':'image/png', '.pdf':'application/pdf' };
let activeExtraction = false;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(value)); };

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

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname === '/api/status' && req.method === 'GET') {
      return json(res, 200, { product:'DockProof', model:process.env.NEBIUS_MODEL || DEFAULT_MODEL, extractionReady:Boolean(process.env.NEBIUS_API_KEY), storage:'browser-local' });
    }
    if (url.pathname === '/api/extract' && req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        return json(res,403,{error:'Use the extraction endpoint from this local application.'});
      }
      if (activeExtraction) return json(res,429,{error:'One extraction is running. Retry when it finishes.'});
      const body = await readJson(req);
      activeExtraction = true;
      try { return json(res,200,await extractFacts(body.documents)); }
      finally { activeExtraction = false; }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Use GET for this resource.'});
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(root)) return json(res,404,{error:'Resource missing.'});
    let data;
    try { data = await readFile(target); }
    catch { return json(res,404,{error:'Resource missing.'}); }
    res.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    json(res, error.status || 500, { error:error.status ? error.message : 'The local request failed. Check the server and try again.', code:error.code || 'request_failed' });
  }
});

server.listen(port,host,() => process.stdout.write(`DockProof listening at http://${host}:${port}\n`));
