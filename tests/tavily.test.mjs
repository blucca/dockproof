import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { searchOfficialRules, tavilyStatus } from '../src/tavily.mjs';
import { TARIFF_URL } from '../web/core/case-engine.mjs';

test('basic searches reserve free credits before HTTP and preserve their source boundary', async () => {
  const dir=fs.mkdtempSync(path.join(tmpdir(),'dockproof-tavily-'));
  const file=path.join(dir,'budget.json');
  const config={version:1,approvedCredits:3,reservedCredits:0,freeReserveCredits:100,expiresAt:'2099-01-01T00:00:00Z'};
  fs.writeFileSync(file,JSON.stringify(config));
  const env={TAVILY_API_KEY:'test-only-key',TAVILY_BUDGET_FILE:file,TAVILY_BUDGET_RUNTIME_DIR:dir};
  let used=0, calls=0, networkFail=false;
  const fetchImpl=async(url,options)=>{
    calls++;
    if(url==='https://www.xpo.com/tariff-library/'){
      assert.equal(options.headers.Authorization,undefined);
      return new Response(`<div data-items="[{&quot;href&quot;:&quot;${TARIFF_URL}&quot;},{&quot;href&quot;:&quot;https://www.xpo.com/cdn/CNWY_199-AK.3_Tri-Fold.pdf&quot;}]"></div>`);
    }
    assert.equal(options.headers.Authorization,'Bearer test-only-key');
    if(url.endsWith('/usage'))return Response.json({account:{current_plan:'Researcher',plan_limit:1000,plan_usage:used,paygo_usage:0}});
    const body=JSON.parse(options.body);
    assert.equal(body.search_depth,'basic');assert.equal(body.auto_parameters,false);assert.equal(body.include_answer,false);
    assert.equal(body.query.includes('SECRET-PRO'),false);
    assert.ok(JSON.parse(fs.readFileSync(file)).reservedCredits>=1);
    if(networkFail)throw new Error('Connection lost');
    return Response.json({request_id:'test-request',usage:{credits:1},results:[
      {title:'Pinned tariff',url:TARIFF_URL,content:'Individual damaged piece'},
      {title:'Other tariff',url:'https://www.xpo.com/cdn/CNWY_199-AK.4.pdf',content:'Review effective date'},
      {title:'Spoofed host',url:'https://www.xpo.com.evil.example/rules',content:'Discard'},
      {title:'Banking rule',url:'https://www.ecfr.gov/current/title-12/chapter-X/part-1005',content:'Discard unrelated title'},
      {title:'CFR',url:'https://www.ecfr.gov/current/title-49/part-1005',content:'Claim evidence'},
    ]});
  };
  try {
    assert.equal(tavilyStatus({env}).ready,true);
    const result=await searchOfficialRules({topic:'liability',serviceType:'spot_quote',freightClass:'70',pro:'SECRET-PRO'},{env,fetchImpl});
    assert.equal(result.results.length,3);assert.equal(result.results[0].relationship,'pinned_tariff');
    assert.equal(result.results[1].relationship,'other_tariff');assert.match(result.query,/spot quote class 70/);
    assert.equal(result.usage,undefined);assert.equal(calls,3);
    assert.equal(result.library.status,'pinned_listed');assert.deepEqual(result.library.tariffs,[TARIFF_URL]);
    networkFail=true;
    await assert.rejects(searchOfficialRules({topic:'filing'},{env,fetchImpl}),{code:'rule_connection'});
    assert.equal(JSON.parse(fs.readFileSync(file)).reservedCredits,2);
    used=900;
    await assert.rejects(searchOfficialRules({topic:'filing'},{env,fetchImpl}),{code:'rule_free_limit'});
    assert.equal(JSON.parse(fs.readFileSync(file)).reservedCredits,2);
    const before=calls;
    fs.writeFileSync(file,JSON.stringify({...config,reservedCredits:3}));
    await assert.rejects(searchOfficialRules({topic:'filing'},{env,fetchImpl}),{code:'rule_budget_reached'});
    await assert.rejects(searchOfficialRules({topic:'arbitrary query'},{env,fetchImpl}),{code:'rule_input'});
    assert.equal(calls,before);assert.equal(tavilyStatus({env}).ready,false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
