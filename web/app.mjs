import { evaluateCase, applyAction, createPacket, POLICY_VERSION } from './core/case-engine.mjs';
import { zipFiles } from './core/zip.mjs';
import { createEmptyCase } from './core/fact-review.mjs';
import { createIntakeUI } from './intake-ui.mjs';
import { deleteOriginal } from './core/document-intake.mjs';

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => cents == null ? 'Awaiting evidence' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
const date = value => new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const number = value => new Intl.NumberFormat('en-US').format(value);
const today = () => new Date().toISOString().slice(0,10);
const storageKey = `dockproof.case.v2.${POLICY_VERSION}`;
const sample = await fetch(new URL('./data/sample-case.json',import.meta.url)).then(response => {
  if(!response.ok) throw new Error('The example document set failed to load.'); return response.json();
});
const slots={walkthrough:structuredClone(sample),own:null,'import-example':null};
let mode='walkthrough';
try {
  for(const key of Object.keys(slots)) {
    const saved=JSON.parse(localStorage.getItem(`${storageKey}.${key}`)||'null');
    if(saved?.id && Array.isArray(saved.documents)) { evaluateCase(saved); slots[key]=saved; }
  }
  const last=localStorage.getItem('dockproof.active-workspace');
  if(slots[last])mode=last;
} catch { $('#save-state').textContent='Browser session'; }
let state=slots[mode];let selectedId=mode==='walkthrough'?'claim_worksheet':state.documents[0]?.id;let selectedLine=mode==='walkthrough'?4:1;let selectedPage=1;let activeTab=mode==='walkthrough'?'desk':'intake';let evaluation;let toastTimer;let intake;

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
  slots[mode]=state;
  try {localStorage.setItem(`${storageKey}.${mode}`,JSON.stringify(state));localStorage.setItem('dockproof.active-workspace',mode); $('#save-state').textContent='Saved in this browser';}
  catch {$('#save-state').textContent='Current session';}
}
function commit(next) {state=next;save();render();}
function openDocument(id,line=1,page=1) {
  selectedId=id;selectedLine=line;selectedPage=page;switchTab('desk');renderDocuments();renderEvidence();
  requestAnimationFrame(()=>{
    const target=$(`#evidence-viewer [data-line="${line}"]`);
    if(target)target.scrollIntoView({block:'center',behavior:'instant'});
    else $('#evidence-viewer').scrollIntoView({block:'center',behavior:'instant'});
  });
}
async function changeCase(nextMode,{fresh=false}={}) {
  if(!Object.hasOwn(slots,nextMode))return;
  if(intake?.busy){notify('Finish the current document operation, then switch workspaces.');return;}
  save();
  try {
    if(nextMode==='import-example' && (!slots[nextMode]||fresh)) {
      notify('Reading the original PDF example in this browser…');
      slots[nextMode]=await intake.loadExample();
    }
    if(nextMode==='own' && (!slots.own||fresh)) slots.own=createEmptyCase({id:`dockproof-own-${crypto.randomUUID()}`,title:'My freight claim'});
    if(nextMode==='walkthrough' && fresh)slots.walkthrough=structuredClone(sample);
    mode=nextMode;state=slots[mode];selectedId=mode==='walkthrough'?'claim_worksheet':state.documents[0]?.id;selectedLine=mode==='walkthrough'?4:1;selectedPage=1;
    save();render();switchTab(mode==='walkthrough'?'desk':'intake');
  }catch(error){notify(error.message);}
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
  const piece=state.facts.affectedPieceId||'affected piece';
  const gaps=evaluation.issues.filter(issue=>issue.severity==='blocking').length;
  const original=state.facts.worksheetDemandCents;
  $('#overview').innerHTML=`
    <div class="stat"><div class="stat-label">${original===null||original===undefined?'Source records':'Original worksheet'}</div><div class="stat-value ${amountKnown&&original!=null?'struck':''}">${original==null?state.documents.length:money(original)}</div><div class="stat-detail">${original==null?'PDFs, scans, photos & text, with their sources':state.facts.worksheetWeightLb?`Original weight: ${number(state.facts.worksheetWeightLb)} lb`:'Original requested amount retained'}</div></div>
    <div class="stat"><div class="stat-label">Evidenced loss · ${html(piece)}</div><div class="stat-value">${money(evaluation.actualLossCents)}</div><div class="stat-detail">Net invoice, less retained salvage</div></div>
    <div class="stat"><div class="stat-label">${evaluation.reviewValid?'Reviewed demand':'Proposed demand'}</div><div class="stat-value ${amountKnown?'':'pending'}">${amountKnown?money(evaluation.draftDemandCents):mode==='walkthrough'?`${state.documents.filter(doc=>!doc.received).length} records to collect`:'Select sourced facts'}</div><div class="stat-detail">${evaluation.reviewValid?'Current evidence snapshot approved':evaluation.canConfirm?'Ready for the shipper’s review':`${gaps} evidence / scope checks to resolve`}</div></div>`;
  const doneDocs=state.documents.length>0&&state.documents.every(doc=>doc.received)&&!evaluation.issues.some(issue=>issue.id.startsWith('missing_'));
  $('#steps').innerHTML=[['Collect evidence',doneDocs],['Review the amount',evaluation.reviewValid],['Prepare the packet',evaluation.reviewValid]].map(([label,done],i)=>`<div class="step ${done?'done':i===(doneDocs?1:0)?'active':''}"><span class="step-num">${done?'✓':String(i+1).padStart(2,'0')}</span>${label}</div>`).join('');
  $('#packet-badge').textContent=evaluation.reviewValid?'Ready':'';
}

function renderDocuments() {
  $('#document-count').textContent=`${state.documents.filter(d=>d.received).length}/${state.documents.length}`;
  $('#documents').innerHTML=state.documents.map(doc=>{
    const [name,meta]=documentNames[doc.id]||[doc.name,`${doc.pages?.length||1} page${doc.pages?.length>1?'s':''} · ${doc.kind.replaceAll('_',' ')}`];
    return `<button class="document-button ${doc.id===selectedId?'selected':''} ${doc.received?'':'awaiting'}" data-document="${html(doc.id)}" aria-pressed="${doc.id===selectedId}"><span class="doc-icon" aria-hidden="true">${doc.received?'▤':'⇢'}</span><span><span class="doc-name">${html(name)}</span><span class="doc-meta">${doc.received?html(meta):'Requested · awaiting reply'}</span></span></button>`;
  }).join('')||'<p class="empty-note">Import your source records in Documents &amp; facts.</p>';
}

function renderQuestions() {
  const gaps=evaluation.issues.filter(issue=>issue.severity==='blocking');
  if(!gaps.length) {
    $('#questions').innerHTML=`<div class="all-received"><span class="check-icon" aria-hidden="true">✓</span><div><h3>The source selections support this review.</h3><p>${evaluation.reviewValid?'This evidence snapshot has been reviewed. The complete packet is ready.':`${html(state.facts.affectedPieceId)}’s ${number(state.facts.affectedWeightLb)} lb and the selected booking terms support the calculation. Review the amount to prepare the packet.`}</p>${mode!=='walkthrough'?'<button class="button-plain" data-tab="intake">Revisit the selected facts →</button>':''}</div></div>`;
    return;
  }
  $('#questions').innerHTML=`<div class="questions-heading"><h3>Close the evidence gaps</h3><span class="status-tag amber">${gaps.length} open ${gaps.length===1?'question':'questions'}</span></div>${mode!=='walkthrough'?'<button class="button primary small gap-return" data-tab="intake">Collect records & select facts →</button>':''}`+gaps.slice(0,mode==='walkthrough'?gaps.length:6).map((issue,i)=>{
    const request=mode==='walkthrough'?requests[issue.actionKey]:null;
    return `<section class="gap-card"><div class="gap-top"><span class="gap-index">${i+1}</span><h4>${html(issue.title)}</h4></div><p>${html(issue.detail)}</p>${request?`<div class="gap-actions"><button class="button secondary small" data-request="${html(issue.actionKey)}">View evidence request</button><button class="button-plain" data-action="${html(issue.actionKey)}">${html(request.button)} →</button></div>`:''}</section>`;
  }).join('')+(gaps.length>6&&mode!=='walkthrough'?`<p class="empty-note">${gaps.length-6} further checks are listed with the required fields in Documents &amp; facts.</p>`:'');
}

function renderEvidence() {
  const doc=state.documents.find(doc=>doc.id===selectedId)||state.documents[0];
  if(!doc){$('#evidence-viewer').innerHTML='<div class="empty-viewer"><h3>Your evidence, in context.</h3><p>Import a PDF, scan, photo, or text record. Its pages and lines appear here, linked to each selected fact and calculation.</p><button class="button secondary small" data-tab="intake">Add the first record →</button></div>';return;}
  const heading=`<div class="viewer-heading"><h3>${html(doc.name)}</h3><span>${doc.received?'SOURCE RECORD':'AWAITING RECORD'}</span></div>`;
  if(!doc.received) {
    const key=Object.keys(requests).find(key=>requests[key].documentId===doc.id);
    $('#evidence-viewer').innerHTML=heading+`<div style="padding:18px"><p style="font-size:11px;line-height:1.7;color:var(--muted)">This requested record will be added to the case when its reply arrives. Use the example reply to continue the walkthrough.</p><button class="button secondary small" data-action="${html(key)}">${html(requests[key].button)}</button></div>`;
    return;
  }
  const isImage=['image/png','image/jpeg'].includes(doc.mimeType);
  const photo=isImage?`<div class="original-photo"><img id="original-photo-preview" alt="Original photo: ${html(doc.name)}"><p>Original photo · ${doc.image?.width||'?'} × ${doc.image?.height||'?'} pixels <button class="cite" data-open-original="${html(doc.id)}">Open full original ↗</button></p></div>`:'';
  const blank=!doc.text.trim()?`<div class="empty-viewer"><p>Visual evidence attached. Open the original to inspect it. Read printed text with local English OCR in Documents &amp; facts.</p></div>`:'';
  let offset=0;
  $('#evidence-viewer').innerHTML=heading+photo+blank+`<div class="document-lines">${doc.text.split('\n').map((line,i)=>{
    const match=line.match(/^L(\d+)\s+(.*)$/);const lineNumber=match?Number(match[1]):i+1; const body=match?match[2]:line;
    const page=doc.pages?.find(page=>offset>=page.start&&offset<=page.end);const lineInfo=page?.lines?.find(item=>offset>=item.start&&offset<=item.end);offset+=line.length+1;
    return `${page&&page.start===offset-line.length-1?`<div class="source-page-label">PAGE ${page.page} · ${page.extraction?.derived ? 'OCR-DERIVED TEXT · COMPARE WITH ORIGINAL' : isImage ? 'ORIGINAL IMAGE' : 'SOURCE TEXT'}</div>`:''}<div class="document-line ${selectedLine===lineNumber?'highlighted':''}" data-line="${lineNumber}"><span class="line-no">${String(lineInfo?.line||lineNumber).padStart(2,'0')}</span><span>${html(body)}</span></div>`;
  }).join('')}</div><div class="viewer-footer">${doc.synthetic?'Synthetic example record':'Imported source record'} · ${doc.pages?.length||1} page${doc.pages?.length>1?'s':''} · ${doc.text.split('\n').length} lines${doc.sha256?`<br>SHA-256 ${html(doc.sha256.slice(0,16))}… <button class="cite" data-open-original="${html(doc.id)}" data-page="${selectedPage}">Open original · p${selectedPage} ↗</button>`:''}</div>`;
  if(isImage)intake?.displayOriginalImage(doc.id,$('#original-photo-preview'));
}

function cite(evidence,label='↗ source') {
  if(!evidence)return '';
  return `<button class="cite" data-cite="${html(evidence.documentId)}" data-line="${evidence.globalLine||evidence.line||1}" data-page="${evidence.page||1}" title="Open source at page ${evidence.page||1}, line ${evidence.line||1}">${html(label)}</button>`;
}

function renderCalculation() {
  const selectedMath=evaluation.math.filter(row=>['gross_invoice','trade_discount','salvage','actual_loss'].includes(row.id));
  const rows=selectedMath.map(row=>`<div class="math-line"><div class="math-label">${html(row.label)}</div><div class="math-number"><span>${['trade_discount','salvage'].includes(row.id)?'− ':''}${money(row.valueCents)}</span>${cite(row.evidence?.[row.id==='trade_discount'?1:0])}</div>${row.id==='actual_loss'?`<div class="math-equation">${html(row.expression)}</div>`:''}</div>`).join('');
  const reference=evaluation.referenceLimitCents;
  const rate=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(evaluation.rateCentsPerLb/100);
  $('#calculation').innerHTML=`<h3>Follow the dollars</h3><p class="subtitle">One damaged piece. Invoice value and tariff terms, side by side.</p>${rows}
    <div class="cap-card"><div class="cap-title">Tariff reference limit</div><div class="cap-number">${reference===null?'Awaiting evidence':money(reference)}</div><p>${reference===null?'Select the affected-piece weight and documented booking terms.':`${number(state.facts.affectedWeightLb)} lb × ${rate}/lb · ${state.facts.serviceType==='spot_quote'?'spot quote':`class ${html(state.facts.freightClass)}`}`}</p>${reference!==null?`<div style="margin-top:8px;display:flex;gap:5px">${cite(state.facts.provenance.affectedWeightLb,'↗ weight')}${cite(state.facts.provenance.serviceType,'↗ terms')}<a class="cite" href="${html(evaluation.sources.find(s=>s.id==='xpo_liability').url)}" target="_blank" rel="noreferrer">↗ rule p19</a></div>`:''}</div>
    ${mode==='walkthrough'?`<label class="scenario-label" for="service-scenario">Example booking scenario</label><select class="scenario-select" id="service-scenario"><option value="standard_tariff" ${state.facts.serviceType==='standard_tariff'?'selected':''}>Standard tariff · class 70</option><option value="spot_quote" ${state.facts.serviceType==='spot_quote'?'selected':''}>Spot quote · $1 per lb</option></select><p class="scenario-note">Switching the example updates the booking record and opens a fresh review.</p>`:'<button class="button-plain" data-tab="intake">Review source-linked facts →</button>'}`;
}

function renderReview() {
  if(evaluation.reviewValid) {
    $('#review').innerHTML=`<div class="review-area"><div class="reviewed-mark"><span class="check-icon" aria-hidden="true">✓</span> Current evidence reviewed</div><p>${money(evaluation.draftDemandCents)} is the selected demand. The packet preserves the original records and the complete calculation.</p><button class="button primary" data-tab="packet">Open claim packet →</button><button class="button-plain" data-action="reset_review">Reopen review</button></div>`;
    return;
  }
  $('#review').innerHTML=`<div class="review-area"><h4>Shipper’s review</h4><p>${evaluation.canConfirm?`Review the ${money(evaluation.actualLossCents)} actual loss, ${money(evaluation.referenceLimitCents)} reference limit, and selected booking terms.`:'Complete the evidence requests and source selections to review a supported, specific amount.'}</p><label class="review-check"><input id="review-check" type="checkbox" ${evaluation.canConfirm?'':'disabled'}><span>I reviewed the evidence, terms, and ${evaluation.canConfirm?money(evaluation.draftDemandCents):'proposed'} demand.</span></label><button class="button primary" id="confirm-review" data-action="confirm_review" disabled>Approve ${evaluation.canConfirm?money(evaluation.draftDemandCents):'the'} ${state.synthetic?'example ':''}packet</button></div>`;
}

function draftLetter() {
  return `To: XPO Freight Claims\nFrom: ${state.shipment.shipper||'Select the shipper'}\nConsignee: ${state.shipment.consignee||'Select the consignee'}\n\nPRO: ${state.shipment.pro||'Select the PRO'}\nBill of lading: ${state.shipment.bol||'Select the BOL'}\nDelivery: ${state.shipment.deliveryDate||'Select the delivery date'}\nAffected piece: ${state.facts.affectedPieceId||'Select the affected piece'}\n\nThe invoice, delivery receipt, inspection record, affected-piece weight, and booking terms form the claim evidence.\n\nThe completed letter will identify the shipment, assert carrier liability, and state the shipper-reviewed demand.\n\n${state.synthetic?'SYNTHETIC EXAMPLE — ':''}Evidence collection and review in progress.`;
}

function renderPacket() {
  const ready=evaluation.status==='ready';
  const packet=ready?createPacket(state,{today:today()}):null;
  const deadline=evaluation.deadlines.find(item=>item.id==='carrier_receipt_deadline');
  const letter=packet?.files.find(file=>file.name.includes('cover-letter'))?.content||draftLetter();
  const originalDocs=state.documents.filter(doc=>doc.sha256);
  const files=packet?[...packet.files.map(file=>file.name),...originalDocs.map(doc=>`Original · ${doc.originalName||doc.name}`)]:['Claim cover letter','Valuation audit · CSV & JSON','Official rule sources','Source / OCR text and original PDFs, photos & text files','Printable review','Document and original-file manifest'];
  $('#packet').innerHTML=`<div class="packet-layout"><article class="packet-paper"><div class="paper-label">${state.synthetic?'SYNTHETIC EXAMPLE · ':''}${ready?'SHIPPER-REVIEWED DRAFT':'PREPARATION IN PROGRESS'}</div><h2>Freight damage claim</h2><div class="mini-label">${html(state.shipment.pro||'Shipment identity pending')} · Piece ${html(state.facts.affectedPieceId||'pending')}</div><div class="amount-large">${ready?money(evaluation.draftDemandCents):'Review to prepare'}</div><pre>${html(letter)}</pre></article><aside class="packet-side"><span class="status-tag ${ready?'green':'amber'}">${ready?'Ready for download':'Awaiting evidence review'}</span><h3 style="margin-top:16px">A complete record copy.</h3><p>The packet includes the reviewed claim, source text, original files, valuation, and rule references. Imported originals are matched to their SHA-256 fingerprints on download.</p><button class="button primary" id="download-packet" ${ready?'':'disabled'}>Download evidence packet (.zip)</button><button class="button secondary" id="print-packet" ${ready?'':'disabled'}>Print reviewed claim / Save PDF</button>${ready?'':`<button class="button-plain" data-tab="desk">Return to the evidence desk →</button>`}<div class="deadline">Written claim received by XPO<strong>${deadline?date(deadline.date):'Confirm delivery date'}</strong><span>Delivery + 9 calendar months</span></div><p style="font-size:10px">Filing status: <strong>${html(evaluation.filingStatus.replaceAll('_',' '))}.</strong><br>Attach the packet through the <a class="text-link" target="_blank" rel="noreferrer" href="https://www.xpo.com/help-center/claims-and-refunds/how-file-claims-and-refunds/">official filing process</a>. Record the carrier’s confirmation when received.</p><ul>${files.map((name,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span>${html(name)}</li>`).join('')}</ul></aside></div>`;
}

function renderRules() {
  $('#rules').innerHTML=`<div class="rules-layout"><div><div class="eyebrow">VERSIONED RULES · VERIFIED OCT 9, 2026</div><h2 style="margin-top:12px">The basis behind the amount.</h2><p>Each rule is tied to a named source, version, and supported shipment scope. The shipper’s controlling agreement supplies the terms for an actual case.</p>${evaluation.sources.map(source=>`<section class="rule-card"><h3>${html(source.title)}</h3><p>${html(source.description)}</p><a class="text-link" href="${html(source.url)}" target="_blank" rel="noreferrer">${html(source.locator)} ↗</a></section>`).join('')}</div><aside class="scope-card"><h3>Supported calculation scope</h3><ul><li>XPO US interstate LTL</li><li>New, ordinary goods under the class table</li><li>Documented actual freight class</li><li>One identified damaged shipping piece</li><li>Visible damage recorded at delivery</li><li>Direct shipper booking</li><li>Documented standard tariff or spot quote</li><li>Invoice value, trade discount, retained salvage</li></ul><p>Special commodities, used goods, broker agreements, excess-value coverage, and concealed damage enter a separate terms review.</p><h3 style="margin-top:22px">Three distinct amounts</h3><p><strong>Evidenced loss</strong> follows the invoice and salvage.<br><strong>Reference limit</strong> follows the selected carrier terms.<br><strong>Requested amount</strong> is the specific demand approved for this case.</p><p>Carrier receipt and actual payment are subsequent events, recorded from their own evidence.</p><div class="eyebrow" style="margin-top:19px">${html(POLICY_VERSION)}</div></aside></div>`;
}

function render() {
  evaluation=evaluateCase(state,{today:today()});
  $('#case-label').textContent=`${mode==='own'?'MY CLAIM':mode==='import-example'?'PDF EXAMPLE':'GUIDED EXAMPLE'} / ${state.shipment.pro||'SOURCE SELECTION IN PROGRESS'}`;
  $('#case-title').textContent=mode==='walkthrough'?'C3 · Visible damage at delivery':state.facts.affectedPieceId?`${state.facts.affectedPieceId} · Source-linked claim review`:state.title;
  $('#reset-case').textContent=mode==='own'?'Start new claim':mode==='import-example'?'Reload PDF example ↺':'Reset example ↺';
  $('#workspace-method').textContent=mode==='walkthrough'?'Curated example · deterministic audit':'Selected facts · deterministic audit · local originals';
  $('#workspace-origin').textContent=state.synthetic?'Synthetic shipment and records · USD':'Your imported records · USD';
  $('#tab-intake').hidden=mode==='walkthrough';
  for(const button of document.querySelectorAll('.case-switcher [data-case]'))button.setAttribute('aria-pressed',String(button.dataset.case===mode));
  renderOverview();renderDocuments();renderQuestions();renderEvidence();renderCalculation();renderReview();renderPacket();renderRules();
  if(mode!=='walkthrough')intake?.render();
}

function switchTab(tab) {
  activeTab=tab;
  for(const candidate of ['intake','desk','packet','rules']) {
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
document.addEventListener('click',async event=>{
  const element=event.target.closest('button,a');if(!element)return;
  if(element.dataset.case) {await changeCase(element.dataset.case);return;}
  if(element.dataset.tab) {switchTab(element.dataset.tab);return;}
  if(element.dataset.document) {selectedId=element.dataset.document;selectedLine=0;selectedPage=1;renderDocuments();renderEvidence();return;}
  if(element.dataset.cite) {
    openDocument(element.dataset.cite,Number(element.dataset.line)||1,Number(element.dataset.page)||1);return;
  }
  if(element.dataset.request) {
    currentRequest=requests[element.dataset.request];$('#request-title').textContent=currentRequest.title;$('#request-body').textContent=currentRequest.text();$('#request-dialog').showModal();return;
  }
  if(element.dataset.action) {act(element.dataset.action);return;}
  if(element.id==='reset-case') {if(intake.busy){notify('Finish the current document operation first.');return;}if(mode==='own')$('#reset-dialog').showModal();else await changeCase(mode,{fresh:true});}
  if(element.id==='confirm-reset-own') {
    if(intake.busy){notify('Finish the current document operation first.');return;}
    const previous=state.documents.map(doc=>doc.id);$('#reset-dialog').close();
    await changeCase('own',{fresh:true});
    intake.forgetOriginals(previous);
    for(const id of previous)try{await deleteOriginal(id);}catch{/* The active claim has its own record IDs. */}
  }
  if(element.id==='copy-request') navigator.clipboard.writeText(currentRequest.text()).then(()=>notify('Evidence request copied.')).catch(()=>notify('Select and copy the request text.'));
  if(element.id==='download-packet') {
    element.disabled=true;
    try {const packet=await intake.preparePacket(createPacket(state,{today:today()}));download(zipFiles(packet.files),packet.filename);notify(`${packet.files.length} files prepared, including the original source bytes. Carrier submission is the next handoff.`);}
    catch(error){notify(error.message);}
    finally{element.disabled=false;}
  }
  if(element.id==='print-packet') {switchTab('packet');window.print();}
});
document.addEventListener('change',event=>{
  if(event.target.id==='review-check') $('#confirm-review').disabled=!event.target.checked||!evaluation.canConfirm;
  if(event.target.id==='service-scenario') {selectedId='rate_confirmation';selectedLine=3;act('set_service',{service:event.target.value});}
});

intake=createIntakeUI({getState:()=>state,commit,notify,openDocument});
render();
for(const tab of ['intake','desk','packet','rules']) {
  $(`#panel-${tab}`).hidden=tab!==activeTab;
  $(`#tab-${tab}`).setAttribute('aria-selected',String(tab===activeTab));
}
const linkedCase=new URLSearchParams(location.search).get('case');
if(linkedCase&&Object.hasOwn(slots,linkedCase))changeCase(linkedCase);
