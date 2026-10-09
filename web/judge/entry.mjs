const $ = selector => document.querySelector(selector);
let endpoint;
const fragment = new URLSearchParams(location.hash.slice(1));
const supplied = fragment.get('access');
if (supplied) {
  $('#access-code').value = supplied;
  history.replaceState(null, '', location.pathname + location.search);
}

function openWorkspace(own = false) {
  if (!endpoint) return;
  const access = $('#access-code').value.trim();
  if (!access) {
    $('#entry-status').textContent = 'Enter the evaluation access code from the Devpost testing instructions.';
    $('#access-code').focus();
    return;
  }
  const url = new URL('/', endpoint.origin);
  url.search = own ? '?case=own' : '?case=scan-example&live=1';
  url.hash = new URLSearchParams({access}).toString();
  location.assign(url);
}

$('#entry-form').addEventListener('submit',event => {event.preventDefault();openWorkspace();});
$('#open-own').addEventListener('click',() => openWorkspace(true));
try {
  const response = await fetch(new URL('./endpoint.json',import.meta.url),{cache:'no-store'});
  if (!response.ok) throw new Error('endpoint');
  endpoint = await response.json();
  const origin = new URL(endpoint.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('endpoint');
  $('#open-live').disabled = false;
  $('#open-own').disabled = false;
  $('#entry-status').textContent = 'Live evaluation is ready. Your supplied access code opens the full workflow.';
} catch {
  endpoint = null;
  $('#entry-status').textContent = 'The evaluation connection is being restored. Reload this page to reconnect; the public example is ready below.';
}
