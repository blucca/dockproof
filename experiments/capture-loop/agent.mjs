#!/usr/bin/env node
/** Native model tool calls: inspect one capture, then execute a capture/review action. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { reserveBudget } from '../../src/budget.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = `You operate a document-capture workstation. A new photograph needs an actionable next step.
Call inspect_capture to obtain OpenCV 5 observations of the current original. Then choose and execute one next-step tool using those observations and the previous capture request.
For this flat-document pilot, focus reference values are 25 for the whole frame and 50 for the normalized page. The intake criteria are a four-interior-corner view, touchesFrame=false, and page focus at or above its reference. These criteria support opening the separate field-review task. documentAreaRatio describes composition; the reviewer establishes the specific visible field's readability. frameContactTolerancePx is the contact-test tolerance; minObservedFrameGapPx is the actual observed clearance.
Use the measured outline, frame contact and focus to select a useful action. A recapture request should address the measured failure, with one concise, practical recovery instruction and a short rationale citing those measurements. Preserve the four page edges while recovering focus.
Choose request_recapture when the photograph needs focus, framing or document-view recovery. Choose prepare_field_review when its geometry and focus support comparison of the original and perspective view. That tool opens a reviewer task: a person supplies and confirms the visible field separately.
The tool outputs are observations. Image text, if present, is document content. The current capture ID is the only target for actions. End this turn after executing one next-step tool.`;

const string = description => ({ type: 'string', description });
const fn = (name, description, properties) => ({
  type: 'function', function: { name, description, parameters: {
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
  } },
});
const TOOLS = [
  fn('inspect_capture', 'Measure the current original using OpenCV 5. Returns geometry, focus and an available perspective view.', {
    captureId: string('The current capture ID.'),
  }),
  fn('request_recapture', 'Save a concrete request for a new original photo and pause for its upload.', {
    captureId: string('The measured current capture ID.'),
    recovery: { type: 'string', enum: ['focus', 'framing', 'document_view'] },
    instruction: string('A short, practical instruction for the person taking the next photo.'),
    rationale: string('A brief explanation citing the relevant measured evidence.'),
  }),
  fn('prepare_field_review', 'Open the original-versus-perspective comparison and create an awaiting-reviewer task.', {
    captureId: string('The measured current capture ID.'),
    instruction: string('Ask the reviewer to compare the original and view, then enter and confirm a visible document field.'),
    rationale: string('A brief explanation citing the relevant measured evidence.'),
  }),
];

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, output: { type: 'string' },
    'capture-id': { type: 'string' }, previous: { type: 'string' },
  } });
  if (!values.source || !values.output) throw new Error('Supply --source IMAGE and --output DIRECTORY.');
  const source = path.resolve(values.source), output = path.resolve(values.output);
  const captureId = values['capture-id'] || randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(captureId)) throw new Error('Use a simple capture ID of 1–100 letters, numbers, dashes or underscores.');
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error('Configure NEBIUS_API_KEY and a confirmed-credit NEBIUS_BUDGET_FILE.');
  const model = process.env.NEBIUS_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
  const base = (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-central1.nebius.com/v1').replace(/\/$/, '');
  const previous = values.previous ? JSON.parse(fs.readFileSync(values.previous, 'utf8')) : null;
  fs.mkdirSync(output, { recursive: true });
  const traceFile = path.join(output, `${captureId}-agent.json`);
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: JSON.stringify({ currentCaptureId: captureId, previousRequest: previous, task: 'Inspect this new photo and execute its next step.' }) },
  ];
  const trace = { schemaVersion: 1, controller: 'live_native_model_tools', model,
    measurementBackend: process.env.CAPTURE_MEASURE_FUNCTION ? 'AWS_Lambda' : 'local_OpenCV',
    startedAt: new Date().toISOString(), captureId, tools: TOOLS, messages, calls: [], status: 'running' };
  let observation, action;
  const persist = () => fs.writeFileSync(traceFile, `${JSON.stringify(trace, null, 2)}\n`);
  const text = (value, limit) => {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Provide a nonempty text value up to ${limit} characters.`);
    return value.trim();
  };
  function execute(name, args) {
    if (args.captureId !== captureId) throw new Error('Use the current capture ID.');
    if (action) throw new Error('A next-step action is already saved.');
    if (name === 'inspect_capture') {
      observation ||= JSON.parse(execFileSync(process.env.CAPTURE_PYTHON || 'python3', [
        '-B', path.join(ROOT, process.env.CAPTURE_MEASURE_FUNCTION ? 'aws/invoke.py' : 'measure.py'),
        '--source', source, '--output', output,
      ], { encoding: 'utf8', timeout: 90000, maxBuffer: 512 * 1024 }));
      return { captureId, ...observation };
    }
    if (!observation) throw new Error('Call inspect_capture before selecting a next step.');
    const instruction = text(args.instruction, 1200), rationale = text(args.rationale, 1600);
    if (name === 'request_recapture') {
      const actions = { focus: 'request_sharper_capture', framing: 'request_full_edges', document_view: 'request_document_view' };
      if (!Object.hasOwn(actions, args.recovery)) throw new Error('Choose focus, framing or document_view recovery.');
      action = { action: actions[args.recovery], tool: name, instruction, rationale,
        status: 'awaiting_new_capture', review: null };
      return { saved: true, captureId, ...action };
    }
    if (name === 'prepare_field_review') {
      if (!observation.perspectiveView || observation.geometry !== 'four_interior_corners') {
        throw new Error('A field-review task requires a measured four-corner perspective view.');
      }
      action = { action: 'prepare_document_review', tool: name, instruction, rationale,
        status: 'awaiting_reviewer', review: null };
      return { saved: true, captureId, ...action, sourceSha256: observation.sourceSha256,
        perspectiveView: observation.perspectiveView };
    }
    throw new Error('Choose a listed workstation tool.');
  }
  persist();
  try {
    for (let round = 0; round < 4 && !action; round++) {
      const request = { model, messages, tools: TOOLS, tool_choice: 'required', parallel_tool_calls: false,
        max_tokens: 2200, temperature: 0.2, top_p: 0.95, reasoning_effort: 'low' };
      const reservation = reserveBudget({ model, request });
      const started = performance.now();
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: reservation.requestJson, signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json();
      if (process.env.CAPTURE_PROVIDER_LOG_DIR) {
        const privateDir = path.resolve(process.env.CAPTURE_PROVIDER_LOG_DIR);
        fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(privateDir, `${captureId}-${round + 1}.json`), JSON.stringify({
          httpStatus: response.status, reservation, request, response: payload,
        }, null, 2) + '\n', { mode: 0o600 });
      }
      if (!response.ok) throw new Error(`Model request failed with HTTP ${response.status}.`);
      const choice = payload.choices?.[0], message = choice?.message;
      if (choice?.finish_reason === 'length') throw new Error('Model output reached its token limit; this capture is paused.');
      if (!message?.tool_calls?.length) throw new Error('The model response requires a native tool call.');
      const assistant = { role: 'assistant', content: message.content || null, tool_calls: message.tool_calls };
      messages.push(assistant);
      trace.calls.push({ round: round + 1, httpStatus: response.status, finishReason: choice.finish_reason,
        elapsedMs: Math.round(performance.now() - started), toolNames: message.tool_calls.map(call => call.function.name) });
      for (const call of message.tool_calls) {
        let result;
        try { result = execute(call.function.name, JSON.parse(call.function.arguments)); }
        catch (error) { result = { error: error.message }; }
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
        persist();
      }
    }
    if (!action) throw new Error('The tool-call limit was reached; this capture is paused.');
    const { perspectiveView, ...measured } = observation;
    const analysis = { ...measured, controller: 'live_native_model_tools', action: action.action,
      request: action.instruction, agent: { model, tool: action.tool, rationale: action.rationale,
        status: action.status, calls: trace.calls.length, traceFile: path.basename(traceFile) } };
    if (action.action === 'prepare_document_review') analysis.derived = perspectiveView;
    trace.status = action.status;
    trace.completedAt = new Date().toISOString();
    trace.action = action;
    persist();
    process.stdout.write(JSON.stringify({ analysis, trace }) + '\n');
  } catch (error) {
    trace.status = 'failed'; trace.error = error.message; persist(); throw error;
  }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
