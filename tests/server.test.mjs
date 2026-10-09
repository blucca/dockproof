import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDockproofServer } from '../src/server.mjs';

async function withServer(options, run) {
  const server = createDockproofServer(options);
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
const env = {DOCKPROOF_ACCESS_TOKEN:'test-only-evaluation-access',NEBIUS_API_KEY:'test-only-provider-key'};
const budgetStatus = () => ({ready:true,code:'budget_ready',message:'Active.',remainingMicroUsd:1000});

test('hosted extraction requires evaluation access; provider credentials stay server-side',async()=>{
  let calls=0;
  await withServer({env,budgetStatus,extract:async documents=>{calls++;return {mode:'live',documents:documents.length};}},async base=>{
    const plain=await fetch(base+'/api/status').then(r=>r.json());
    assert.equal(plain.extractionReady,false);assert.equal(plain.access.required,true);
    assert.equal(plain.budget.remainingMicroUsd,undefined);
    const denied=await fetch(base+'/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"documents":[]}'});
    assert.equal(denied.status,401);assert.equal(calls,0);
    const headers={Authorization:`Bearer ${env.DOCKPROOF_ACCESS_TOKEN}`,'Content-Type':'application/json',Origin:base};
    const status=await fetch(base+'/api/status',{headers}).then(r=>r.json());assert.equal(status.extractionReady,true);
    const badOrigin=await fetch(base+'/api/extract',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:'{"documents":[]}'});
    assert.equal(badOrigin.status,403);assert.equal(calls,0);
    const run=await fetch(base+'/api/extract',{method:'POST',headers,body:'{"documents":[{}]}'});
    assert.equal(run.status,200);assert.deepEqual(await run.json(),{mode:'live',documents:1});assert.equal(calls,1);
    const html=await fetch(base+'/').then(r=>r.text());assert.match(html,/name="dockproof-api" content="\/api"/);
    assert.equal(html.includes(env.DOCKPROOF_ACCESS_TOKEN),false);assert.equal(html.includes(env.NEBIUS_API_KEY),false);
    assert.deepEqual(await fetch(base+'/api/health').then(r=>r.json()),{ok:true,product:'DockProof',version:'0.5.0'});
  });
});

test('local mode preserves manual and optional model access',async()=>{
  await withServer({env:{},budgetStatus},async base=>{
    const status=await fetch(base+'/api/status').then(r=>r.json());
    assert.equal(status.access.required,false);assert.equal(status.access.authorized,true);assert.equal(status.extractionReady,false);
    assert.equal((await fetch(base+'/core/case-engine.mjs')).status,200);
  });
});
