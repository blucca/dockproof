# DockProof — submitted engineering feedback

Submitted to the Nebius × NVIDIA Global AI Hackathon on 10 October 2026, in the **Best apps and agents** track. The answers below preserve the submitted technical feedback; judge-access instructions are stored with the private submission.

Project: https://devpost.com/software/dockproof

## Which model(s) did you use, and why did you choose that size/variant?

NVIDIA nvidia/nemotron-3-super-120b-a12b (Nemotron 3 Super, 120B hybrid MoE) through Nebius Token Factory, us-central1. The task combines seven text-bearing records from eight original files: shipment identity, invoice amounts, discounts, salvage, individual-piece weight and carrier booking terms. We chose Super for a structured, multi-document extraction workload with exact quotations and 33 typed field slots. Hosted access let a lightweight Node application use this NVIDIA model while PDF parsing, scan OCR and original-file storage stayed in the browser. The filmed request returned 32 source-matched candidates in 11.173 seconds; the final deployed adapter check returned 30 candidates in 7.535 seconds. Both covered all 27 required fields for that synthetic case.

## How would you rate Nemotron's output quality for your use case? (1 = Poor, 10 = Excellent)

Engineering assessment: 7/10 for proposing freight-document facts for source review.

Strengths: Super followed the bounded per-field schema, preserved distinct 600 lb shipment / 150 lb affected-piece evidence, identified invoice discount and retained salvage, and supplied exact source excerpts across the record set. The final deployed check covered 27 required fields and supported the deterministic $750 review.

Observed failures shaped the product: an early open array repeated entries to the output ceiling; one response used an unknown document ID; an inspection date was assigned to carrier claim receipt; a separate response left an explicit $0 allowance open. In the first public-server run, the model copied "Freight class: 70" correctly while putting commentary in the value. The calculation engine stopped approval until a reviewer selected 70 from the original source.

We addressed these with typed field slots, request-specific source-ID enums, explicit claim-receipt evidence, and a supported-class enum plus class-number/quote validation. An open or disputed field gets a concrete manual source-selection path. The complete browser workflow exported all eight original files with matching SHA-256 fingerprints. Detailed observations: https://github.com/blucca/dockproof/blob/main/docs/model-feedback.md

## Did you fine-tune, prompt-engineer, or use Nemotron out of the box? What was your approach?

Prompt-engineered the hosted base model for the application contract. We use response_format.json_schema with 33 named field slots, each holding up to three distinct candidates and an explicit missing-evidence question. Money uses integer USD cents, discount uses basis points, booleans and shipment terms use their own types, and document IDs are enumerated from the current request. Each candidate carries an exact quote and page; the application resolves its text offsets and validates its source.

The prompt separates affected-piece facts from shipment totals and original worksheet assertions, marks OCR-derived text, and requires explicit wording for carrier claim receipt. Freight class uses the supported numeric class strings and must appear in its quoted source. Current sampling is temperature 0.6, top_p 0.95, repetition_penalty 1.05, reasoning_effort low, with a bounded output. Schema and sampling were refined together using actual requests. The deterministic JavaScript engine calculates scope, valuation and deadlines; the shipper controls fact selection and approval.

## How did Nemotron's performance compare to other models you've used for similar tasks?

The measured comparison for this project is against the manually reviewed source set and across successive Nemotron extraction contracts. The source baseline supplies the required fields, exact excerpts and expected $750 calculation. An open-array contract reached its output ceiling; bounded named slots produced complete reviewable results. The latest deployed run returned 30 source-matched candidates, covered 27 required fields, used class 70 from its source quote and left zero blocking issues in 7.535 seconds.

A controlled cross-model comparison would reuse these exact originals and OCR text, identical field schemas and equivalent output budgets, and report required-field coverage, value-to-quote consistency, invalid source rate and end-to-end review time. Those measures match the shipping team's actual task.

## Which Nebius platform capabilities were most valuable to your project and how?

Nebius Token Factory's OpenAI-compatible chat/completions endpoint and structured-output support were the key capabilities. Our Node.js server calls NVIDIA Nemotron Super through the us-central1 inference API. The application deployment stays lightweight: the browser runs PDF.js and Tesseract, while Token Factory runs the NVIDIA model. The same server hosts the complete web application and API behind HTTPS, with private evaluation access and a persistent credit-budget reservation gate. Original document bytes stay in the browser; extracted text is sent only when the reviewer presses Extract with Nemotron.

The full judge build supports the original scan example and the judges' own records, including live extraction, source selection, review and original-file packet export. The stable entry resolves the current endpoint and is maintained through the judging period.

## How likely are you to recommend running Nemotron on Nebius to other developers? (1 = Unlikely, 10 = Highly Likely)

8/10 for developers building review-oriented document applications. The hosted NVIDIA endpoint and standard API made it practical to connect an open model to a complete, small application. A useful result came from pairing the model with typed outputs, exact-source validation and explicit reviewer actions. Stronger model-specific extraction examples and credit-only project spending controls would make the path from first request to a maintained evaluation build smoother.

## How would you rate your experience running Nemotron inference on Nebius compared to previous cloud or local development environments? (1 = Poor, 10 = Excellent)

8/10 for this lightweight deployment. Token Factory supplied model access through a standard inference request, so the application work centered on the document contract and review experience. Local serving would add model distribution, GPU sizing and a model-serving lifecycle; this prototype instead maintains a small Node web/API service and browser-local document processing. The latest deployed adapter request took 7.535 seconds; the filmed request took 11.173 seconds, each reading seven text records from eight original synthetic files. Setup and inference feedback would improve with clearer structured-output diagnostics and project-level credit controls.

## What additional features or improvements would have made the Nemotron on Nebius experience more effective for your project?

Three concrete improvements:

1. A model-specific bounded multi-document extraction recipe: typed units, per-field candidate caps, request-specific source-ID enums, exact quotations and open-field examples. Include tests for receipt versus inspection dates and for a correct quote paired with an invalid value.
2. Structured-output diagnostics that identify output-ceiling stops, supported schema features and fields left unanswered. These would have shortened our early extraction iterations.
3. Credit-only project budgets with preflight request reservation and clear exhausted-credit responses. We implemented a persistent application-side gate; a provider-level control would make maintained public evaluation builds simpler.

The accompanying judge-instructions ZIP includes the complete feedback and test walkthrough. Reproduction notes and source: https://github.com/blucca/dockproof/blob/main/docs/model-feedback.md

## What do you most hope to see from the Nemotron team next?

An evidence-first document-understanding recipe from the Nemotron team: exact quotations paired with typed values, explicit missing evidence, distinct event-date semantics, and a compact consistency check between a value and its cited source. Our freight-class failure is a useful example: "Freight class: 70" was copied accurately while the value contained commentary. The next model/application recipe should surface that mismatch immediately and preserve the other valid fields. A small benchmark of realistic multi-document corrections would help builders evaluate review workload as well as extraction coverage.
