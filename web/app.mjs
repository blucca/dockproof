import { evaluateCase, applyAction, createPacket, POLICY_VERSION } from './core/case-engine.mjs';
import { zipFiles } from './core/zip.mjs';

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => cents == null ? 'Awaiting evidence' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
const date = value => new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const number = value => new Intl.NumberFormat('en-US').format(value);
const today = () => new Date().toISOString().slice(0,10);
const storageKey = `dockproof.case.v1.${POLICY_VERSION}`;
const sample = await fetch(new URL('./data/sample-case.json',import.meta.url)).then(response => {
  if(!response.ok) throw new Error('The example document set failed to load.'); return response.json();
});
let state = structuredClone(sample); let selectedId='claim_worksheet'; let selectedLine=4; let activeTab='desk'; let evaluation; let toastTimer;
try {
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(saved?.id===sample.id && Array.isArray(saved.documents)) { evaluateCase(saved); state=saved; }
} catch { $('#save-state').textContent='Browser session'; }

const documentNames = {
  bill_of_lading:['Bill of lading','Shipment · class 70'],
  delivery_receipt:['Delivery receipt','C3 damage recorded'],
  commercial_invoice:['Vendor invoice','5 lines · 10% discount'],
  inspection_record:['Inspection & salvage','C3 · $200 retained value'],
  claim_worksheet:['Original worksheet','$5,000 inherited demand'],
  weight_sheet:['C3 weight sheet','Warehouse reply'],
  rate_confirmation:['Booking terms','Carrier service basis'],
};

const requests = {
  receive_weight: {
    title:'Ask the warehouse for C3’s weight',
    text:()=>`Subject: Piece weight for damaged crate C3 — ${state.shipment.pro}\n\nPlease send the packing manifest or weight record for crate C3 on BOL ${state.shipment.bol}.\n\nThe bill of lading lists 1,000 lb for the full five-crate shipment. We need C3’s individual gross weight, including its packing, tied to the crate ID and shipment.\n\nPlease retain C3, its packing, and the damaged fixtures for carrier inspection.\n\nThank you,\n${state.shipment.shipper}\n\nSYNTHETIC EXAMPLE — prepared request`,
    button:'Add sample warehouse reply', documentId:'weight_sheet', line:4,
  },
  receive_rate: {
    title:'Ask shipping for the booking terms',
    text:()=>`Subject: Booking terms for the C3 damage claim — ${state.shipment.pro}\n\nPlease send the rate confirmation or controlling shipping agreement for BOL ${state.shipment.bol}.\n\nThe claim calculation needs the applicable service: standard tariff or spot quote. Include any special commodity terms, broker agreement, or purchased excess-value coverage that applies.\n\nFor this example, the booking confirmation selects ${state.facts.serviceType==='spot_quote'?'spot-quote':'standard-tariff'} service and new ordinary goods.\n\nThank you,\n${state.shipment.shipper}\n\nSYNTHETIC EXAMPLE — prepared request`,
    button:'Add sample booking confirmation', documentId:'rate_confirmation', line:3,
  },
};

function notify(message) {
  $('#toast').textContent=message; $('#toast').hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);
}
function save() {
  try {localStorage.setItem(storageKey,JSON.stringify(state)); $('#save-state').textContent='Saved in this browser';}
  catch {$('#save-state').textContent='Current session';}
}
function act(action,payload={}) {
  try {
    state=applyAction(state,action,payload);
    if(requests[action]) {selectedId=requests[action].documentId;selectedLine=requests[action].line;}
    save();render();
    if(action==='receive_weight') notify('C3 weight received: 200 lb. The original worksheet stays in the evidence record.');
    if(action==='receive_rate') notify('Booking terms received. Review the supported amount.');
    if(action==='confirm_review') {notify(`${money(evaluation.draftDemandCents)} reviewed. Your claim packet is ready to download.`);switchTab('packet');}
    if(action==='set_service') notify('Example booking terms changed. Review the updated amount before export.');
  } catch(error) {notify(error.message);}
}

function renderOverview() {
  const amountKnown=evaluation.referenceLimitCents!==null;
  const missingRecords=state.documents.filter(doc=>!doc.received).length;
  $('#overview').innerHTML=`
    <div class="stat"><div class="stat-label">Original worksheet</div><div class="stat-value ${amountKnown?'struck':''}">${money(state.facts.worksheetDemandCents)}</div><div class="stat-detail">Used all ${number(state.shipment.totalWeightLb)} lb for one crate</div></div>
    <div class="stat"><div class="stat-label">Evidenced loss · C3</div><div class="stat-value">${money(evaluation.actualLossCents)}</div><div class="stat-detail">Net invoice, less retained salvage</div></div>
    <div class="stat"><div class="stat-label">${evaluation.reviewValid?'Reviewed demand':'Proposed demand'}</div><div class="stat-value ${amountKnown?'':'pending'}">${amountKnown?money(evaluation.draftDemandCents):`${missingRecords} ${missingRecords===1?'record':'records'} to collect`}</div><div class="stat-detail">${evaluation.reviewValid?'Current evidence snapshot approved':amountKnown?'Ready for the shipper’s review':'Piece weight + booking terms'}</div></div>`;
  const doneDocs=state.documents.filter(doc=>doc.received).length===state.documents.length;
  $('#steps').innerHTML=[['Collect evidence',doneDocs],['Review the amount',evaluation.reviewValid],['Prepare the packet',evaluation.reviewValid]].map(([label,done],i)=>`<div class="step ${done?'done':i===(doneDocs?1:0)?'active':''}"><span class="step-num">${done?'✓':String(i+1).padStart(2,'0')}</span>${label}</div>`).join('');
  $('#packet-badge').textContent=evaluation.reviewValid?'Ready':'';
}

function renderDocuments() {
  $('#document-count').textContent=`${state.documents.filter(d=>d.received).length}/${state.documents.length}`;
  $('#documents').innerHTML=state.documents.map(doc=>{
    const [name,meta]=documentNames[doc.id]||[doc.name,doc.kind];
    return `<button class="document-button ${doc.id===selectedId?'selected':''} ${doc.received?'':'awaiting'}" data-document="${html(doc.id)}" aria-pressed="${doc.id===selectedId}"><span class="doc-icon" aria-hidden="true">${doc.received?'▤':'⇢'}</span><span><span class="doc-name">${html(name)}</span><span class="doc-meta">${doc.received?html(meta):'Requested · awaiting reply'}</span></span></button>`;
  }).join('');
}

function renderQuestions() {
  const gaps=evaluation.issues.filter(issue=>issue.severity==='blocking');
  if(!gaps.length) {
    $('#questions').innerHTML=`<div class="all-received"><span class="check-icon" aria-hidden="true">✓</span><div><h3>All evidence is in one place.</h3><p>${evaluation.reviewValid?'This evidence snapshot has been reviewed. The complete packet is ready.':'C3’s 200 lb and the booking terms now support the calculation. Review the selected amount to prepare the packet.'}</p></div></div>`;
    return;
  }
  $('#questions').innerHTML=`<div class="questions-heading"><h3>Close the evidence gaps</h3><span class="status-tag amber">${gaps.length} open ${gaps.length===1?'question':'questions'}</span></div>`+gaps.map((issue,i)=>{
    const request=requests[issue.actionKey];
    return `<section class="gap-card"><div class="gap-top"><span class="gap-index">${i+1}</span><h4>${html(issue.title)}</h4></div><p>${html(issue.detail)}</p>${request?`<div class="gap-actions"><button class="button secondary small" data-request="${html(issue.actionKey)}">View evidence request</button><button class="button-plain" data-action="${html(issue.actionKey)}">${html(request.button)} →</button></div>`:''}</section>`;
  }).join('');
}

function renderEvidence() {
  const doc=state.documents.find(doc=>doc.id===selectedId)||state.documents[0];
  const heading=`<div class="viewer-heading"><h3>${html(doc.name)}</h3><span>${doc.received?'SOURCE RECORD':'AWAITING RECORD'}</span></div>`;
  if(!doc.received) {
    const key=Object.keys(requests).find(key=>requests[key].documentId===doc.id);
    $('#evidence-viewer').innerHTML=heading+`<div style="padding:18px"><p style="font-size:11px;line-height:1.7;color:var(--muted)">This requested record will be added to the case when its reply arrives. Use the example reply to continue the walkthrough.</p><button class="button secondary small" data-action="${html(key)}">${html(requests[key].button)}</button></div>`;
    return;
  }
  $('#evidence-viewer').innerHTML=heading+`<div class="document-lines">${doc.text.split('\n').map((line,i)=>{
    const match=line.match(/^L(\d+)\s+(.*)$/);const lineNumber=match?Number(match[1]):i+1; const body=match?match[2]:line;
    return `<div class="document-line ${selectedLine===lineNumber?'highlighted':''}" data-line="${lineNumber}"><span class="line-no">${String(lineNumber).padStart(2,'0')}</span><span>${html(body)}</span></div>`;
  }).join('')}</div><div class="viewer-footer">Original synthetic record · ${doc.text.split('\n').length} lines · select a citation to jump to its source</div>`;
}

function cite(evidence,label='↗ source') {
  if(!evidence)return '';
  return `<button class="cite" data-cite="${html(evidence.documentId)}" data-line="${evidence.line||1}" title="Open source record at line ${evidence.line||1}">${html(label)}</button>`;
}

function renderCalculation() {
  const selectedMath=evaluation.math.filter(row=>['gross_invoice','trade_discount','salvage','actual_loss'].includes(row.id));
  const rows=selectedMath.map(row=>`<div class="math-line"><div class="math-label">${html(row.label)}</div><div class="math-number"><span>${['trade_discount','salvage'].includes(row.id)?'− ':''}${money(row.valueCents)}</span>${cite(row.evidence?.[row.id==='trade_discount'?1:0])}</div>${row.id==='actual_loss'?`<div class="math-equation">${html(row.expression)}</div>`:''}</div>`).join('');
  const reference=evaluation.referenceLimitCents;
  const rate=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(evaluation.rateCentsPerLb/100);
  $('#calculation').innerHTML=`<h3>Follow the dollars</h3><p class="subtitle">One damaged piece. Invoice value and tariff terms, side by side.</p>${rows}
    <div class="cap-card"><div class="cap-title">Tariff reference limit</div><div class="cap-number">${reference===null?'Awaiting evidence':money(reference)}</div><p>${reference===null?'Receive C3’s weight and the selected booking terms.':`${number(state.facts.affectedWeightLb)} lb × ${rate}/lb · ${state.facts.serviceType==='spot_quote'?'spot quote':'class 70'}`}</p>${reference!==null?`<div style="margin-top:8px;display:flex;gap:5px">${cite(state.facts.provenance.affectedWeightLb,'↗ weight')}${cite(state.facts.provenance.serviceType,'↗ terms')}<a class="cite" href="${html(evaluation.sources.find(s=>s.id==='xpo_liability').url)}" target="_blank" rel="noreferrer">↗ rule p19</a></div>`:''}</div>
    <label class="scenario-label" for="service-scenario">Example booking scenario</label><select class="scenario-select" id="service-scenario"><option value="standard_tariff" ${state.facts.serviceType==='standard_tariff'?'selected':''}>Standard tariff · class 70</option><option value="spot_quote" ${state.facts.serviceType==='spot_quote'?'selected':''}>Spot quote · $1 per lb</option></select><p class="scenario-note">Switching the example updates the booking record and opens a fresh review.</p>`;
}

function renderReview() {
  if(evaluation.reviewValid) {
    $('#review').innerHTML=`<div class="review-area"><div class="reviewed-mark"><span class="check-icon" aria-hidden="true">✓</span> Current evidence reviewed</div><p>${money(evaluation.draftDemandCents)} is the chosen demand for this example. The packet preserves the original worksheet and the complete calculation.</p><button class="button primary" data-tab="packet">Open claim packet →</button><button class="button-plain" data-action="reset_review">Reopen review</button></div>`;
    return;
  }
  $('#review').innerHTML=`<div class="review-area"><h4>Shipper’s review</h4><p>${evaluation.canConfirm?`Review the ${money(evaluation.actualLossCents)} actual loss, ${money(evaluation.referenceLimitCents)} reference limit, and selected booking terms.`:'Complete the evidence requests to review a supported, specific amount.'}</p><label class="review-check"><input id="review-check" type="checkbox" ${evaluation.canConfirm?'':'disabled'}><span>I reviewed the evidence, terms, and ${evaluation.canConfirm?money(evaluation.draftDemandCents):'proposed'} demand.</span></label><button class="button primary" id="confirm-review" data-action="confirm_review" disabled>Approve ${evaluation.canConfirm?money(evaluation.draftDemandCents):'the'} example packet</button></div>`;
}

function draftLetter() {
  return `To: XPO Freight Claims\nFrom: ${state.shipment.shipper}\nConsignee: ${state.shipment.consignee}\n\nPRO: ${state.shipment.pro}\nBill of lading: ${state.shipment.bol}\nDelivery: ${state.shipment.deliveryDate}\nAffected piece: C3\n\nThe delivery receipt identifies visible damage to crate C3. The invoice, inspection record, affected-piece weight, and booking terms form the claim evidence.\n\nThe completed letter will identify the shipment, assert carrier liability, and state the shipper-reviewed demand.\n\nSYNTHETIC EXAMPLE — evidence collection and review in progress.`;
}

function renderPacket() {
  const ready=evaluation.reviewValid;
  const packet=ready?createPacket(state,{today:today()}):null;
  const deadline=evaluation.deadlines.find(item=>item.id==='carrier_receipt_deadline');
  const letter=packet?.files.find(file=>file.name.includes('cover-letter'))?.content||draftLetter();
  const files=packet?.files.map(file=>file.name)||['Claim cover letter','Valuation audit · CSV & JSON','Official rule sources','Seven original evidence records','Printable review','Document manifest'];
  $('#packet').innerHTML=`<div class="packet-layout"><article class="packet-paper"><div class="paper-label">SYNTHETIC EXAMPLE · ${ready?'SHIPPER-REVIEWED DRAFT':'PREPARATION IN PROGRESS'}</div><h2>Freight damage claim</h2><div class="mini-label">${html(state.shipment.pro)} · Piece C3</div><div class="amount-large">${ready?money(evaluation.draftDemandCents):'Review to prepare'}</div><pre>${html(letter)}</pre></article><aside class="packet-side"><span class="status-tag ${ready?'green':'amber'}">${ready?'Ready for download':'Awaiting evidence review'}</span><h3 style="margin-top:16px">A complete record copy.</h3><p>The packet includes the reviewed claim, original evidence, valuation, and rule references. Your carrier portal is the next handoff.</p><button class="button primary" id="download-packet" ${ready?'':'disabled'}>Download evidence packet (.zip)</button><button class="button secondary" id="print-packet" ${ready?'':'disabled'}>Print reviewed claim / Save PDF</button>${ready?'':`<button class="button-plain" data-tab="desk">Return to the evidence desk →</button>`}<div class="deadline">Written claim received by XPO<strong>${deadline?date(deadline.date):'Confirm delivery date'}</strong><span>Delivery + 9 calendar months</span></div><p style="font-size:10px">Filing status: <strong>awaiting carrier submission.</strong><br>Attach the packet through the <a class="text-link" target="_blank" rel="noreferrer" href="https://www.xpo.com/help-center/claims-and-refunds/how-file-claims-and-refunds/">official filing process</a>. Record the carrier’s confirmation when received.</p><ul>${files.map((name,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span>${html(name)}</li>`).join('')}</ul></aside></div>`;
}

function renderRules() {
  $('#rules').innerHTML=`<div class="rules-layout"><div><div class="eyebrow">VERSIONED RULES · VERIFIED OCT 9, 2026</div><h2 style="margin-top:12px">The basis behind the amount.</h2><p>Each rule is tied to a named source, version, and supported shipment scope. The shipper’s controlling agreement supplies the terms for an actual case.</p>${evaluation.sources.map(source=>`<section class="rule-card"><h3>${html(source.title)}</h3><p>${html(source.description)}</p><a class="text-link" href="${html(source.url)}" target="_blank" rel="noreferrer">${html(source.locator)} ↗</a></section>`).join('')}</div><aside class="scope-card"><h3>This example’s scope</h3><ul><li>XPO interstate LTL, NJ → PA</li><li>New, ordinary LED lighting fixtures</li><li>Actual class 70 on the bill of lading</li><li>One shipping piece, C3, visibly damaged</li><li>Damage recorded at delivery</li><li>Direct shipper booking</li><li>Selected standard tariff or spot quote</li><li>Invoice value, trade discount, retained salvage</li></ul><p>Special commodities, used goods, broker agreements, excess-value coverage, and concealed damage enter a separate terms review.</p><h3 style="margin-top:22px">Three distinct amounts</h3><p><strong>Evidenced loss</strong> follows the invoice and salvage.<br><strong>Reference limit</strong> follows the selected carrier terms.<br><strong>Requested amount</strong> is the specific demand approved for this case.</p><p>Carrier receipt and actual payment are subsequent events, recorded from their own evidence.</p><div class="eyebrow" style="margin-top:19px">${html(POLICY_VERSION)}</div></aside></div>`;
}

function render() {
  evaluation=evaluateCase(state,{today:today()});
  renderOverview();renderDocuments();renderQuestions();renderEvidence();renderCalculation();renderReview();renderPacket();renderRules();
}

function switchTab(tab) {
  activeTab=tab;
  for(const candidate of ['desk','packet','rules']) {
    $(`#panel-${candidate}`).hidden=candidate!==tab;
    $(`#tab-${candidate}`).setAttribute('aria-selected',String(candidate===tab));
  }
  $('.workspace-tabs').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

function download(content,name) {
  const link=document.createElement('a');const url=URL.createObjectURL(content);
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

let currentRequest;
document.addEventListener('click',event=>{
  const element=event.target.closest('button,a');if(!element)return;
  if(element.dataset.tab) {switchTab(element.dataset.tab);return;}
  if(element.dataset.document) {selectedId=element.dataset.document;selectedLine=0;renderDocuments();renderEvidence();return;}
  if(element.dataset.cite) {
    selectedId=element.dataset.cite;selectedLine=Number(element.dataset.line)||1;switchTab('desk');renderDocuments();renderEvidence();
    if(window.innerWidth<900) $('#evidence-viewer').scrollIntoView({block:'center',behavior:'smooth'});return;
  }
  if(element.dataset.request) {
    currentRequest=requests[element.dataset.request];$('#request-title').textContent=currentRequest.title;$('#request-body').textContent=currentRequest.text();$('#request-dialog').showModal();return;
  }
  if(element.dataset.action) {act(element.dataset.action);return;}
  if(element.id==='reset-case') {state=structuredClone(sample);selectedId='claim_worksheet';selectedLine=4;save();render();switchTab('desk');notify('A fresh example is ready.');}
  if(element.id==='copy-request') navigator.clipboard.writeText(currentRequest.text()).then(()=>notify('Evidence request copied.')).catch(()=>notify('Select and copy the request text.'));
  if(element.id==='download-packet') {
    try {const packet=createPacket(state,{today:today()});download(zipFiles(packet.files),packet.filename);notify(`${packet.files.length} files prepared. The carrier submission remains the next handoff.`);}
    catch(error){notify(error.message);}
  }
  if(element.id==='print-packet') {switchTab('packet');window.print();}
  if(element.id==='open-extraction') openExtraction();
  if(element.id==='load-extract-example') $('#document-text').value=sample.documents.find(doc=>doc.id==='commercial_invoice').text;
  if(element.id==='extract-live') runExtraction();
});
document.addEventListener('change',event=>{
  if(event.target.id==='review-check') $('#confirm-review').disabled=!event.target.checked||!evaluation.canConfirm;
  if(event.target.id==='service-scenario') {selectedId='rate_confirmation';selectedLine=3;act('set_service',{service:event.target.value});}
});

async function openExtraction() {
  $('#extraction-dialog').showModal();$('#extract-live').disabled=true;
  const local=['localhost','127.0.0.1','::1'].includes(location.hostname);
  if(!local) {
    $('#extraction-status').innerHTML='Live document extraction runs on your local DockProof server with your Nebius key. <a class="text-link" href="https://github.com/blucca/dockproof#run-locally" target="_blank" rel="noreferrer">Open the setup guide ↗</a>';
    return;
  }
  try {
    const status=await fetch('/api/status').then(response=>response.json());
    $('#extraction-status').textContent=status.extractionReady?`${status.model} · sends document text to your Nebius account for candidate-fact extraction.`:'Set NEBIUS_API_KEY in your local server environment to connect the model. The example desk is ready to use.';
    $('#extract-live').disabled=!status.extractionReady;
  } catch {$('#extraction-status').textContent='Start the local Node server with npm start to enable the extraction endpoint.';}
}

async function runExtraction() {
  const text=$('#document-text').value.trim();if(!text){notify('Add the document text first.');return;}
  $('#extract-live').disabled=true;$('#extraction-results').innerHTML='<p class="extract-summary">Reading the document and locating exact quotes…</p>';
  try {
    const response=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documents:[{id:'intake_document',name:'Document text',text}]})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The extraction request failed.');
    $('#extraction-results').innerHTML=`<p class="extract-summary">${result.extraction.facts.length} candidate facts · exact source spans matched · ${Math.round(result.execution.durationMs/1000)} s<br>Review the candidates against your document before using them in a claim.</p>${result.extraction.facts.map(fact=>`<article class="extracted-fact"><h4>${html(fact.field)}: ${html(fact.value)}</h4><blockquote>${html(fact.quote)}</blockquote></article>`).join('')}${result.extraction.questions.map(question=>`<article class="extracted-fact"><h4>Evidence question · ${html(question.field)}</h4><p>${html(question.question)}</p></article>`).join('')}`;
  } catch(error){$('#extraction-results').innerHTML=`<p class="extract-summary">${html(error.message)}</p>`;}
  finally{$('#extract-live').disabled=false;}
}

render();
