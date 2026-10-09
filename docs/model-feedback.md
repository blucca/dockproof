# NVIDIA Nemotron integration observations

Tested October 9–10, 2026, with `nvidia/nemotron-3-super-120b-a12b` through Nebius Token Factory's `us-central1` endpoint. Source material: six original synthetic DockProof records, including two PDFs. Account credentials and raw provider telemetry are retained privately.

## Working document contract

DockProof sends canonical document text with original-file hashes, roles and page ranges. The structured schema gives each of 33 identity, valuation and terms fields a typed slot, a maximum of three distinct candidate values, exact quotations and a missing-evidence question. The application calculates quotation positions and claim amounts; the reviewer selects the evidence snapshot.

The completed run returned 32 candidates covering every required field. All 32 quotes matched their source text and resolved to page/line offsets. The model separated the affected-piece invoice value, discount, retained salvage, packing weight and inherited worksheet demand. Carrier-receipt date remains open for the actual receipt record.

## Observed failure and adjustment

The first request used an open candidate array at temperature 0.1. It repeated the affected-piece entry until the configured output limit; some numeric strings contained unit text and punctuation. That response stopped at the extraction gate.

The successful request used the bounded, typed per-field schema, temperature 0.6, top-p 0.95, repetition penalty 1.05 and low reasoning effort. Both schema and sampling settings changed together. The complete extraction finished in about 10 seconds. This result covers the supplied synthetic document set; further customer document trials extend the evidence base.

## Scanned pages and photos

A subsequent live browser run imported [eight downloadable synthetic originals](https://blucca.github.io/dockproof/data/scans/dockproof-scan-example.zip): a mixed PDF with an OCR delivery page, invoice/supporting records, a printed PNG label and a zero-text JPEG. Seven text-bearing records reached the provider. The source run returned 31 exact-quote candidates and covered all 27 required fields. Semantic review identified one date assignment: the model attached the warehouse inspection date to carrier claim receipt. The public scan example retains 30 candidates and leaves carrier claim receipt open for its own receipt evidence. Source selection yields a $750, 22-file packet. The delivery-date citation resolved to the OCR page; every exported original matched its imported SHA-256.


Browser-local PDF.js and Tesseract produce the canonical text before the model request. Each page records selectable text or English OCR; photos retain their original bytes and optionally add OCR text. Quotes point into that exact transcript, with the original scan available alongside it. Printed `lb.` was observed as `Ib.` in one OCR label; original-image comparison is part of selecting that value.

## Useful provider improvements

- A compact, model-specific example for typed, bounded multi-document extraction would accelerate setup.
- A schema example showing separate field coverage, missing-evidence questions and exact quotes fits document-review applications well.
- Visible credit-only request caps would help developers run public evaluation builds within promotional resources.

Carrier claim receipt receives individual review in the interface; the single-value selection action handles the other fields. Recorded examples retain the source-run and published-candidate counts separately.

## Follow-up source and receipt validation

During the October 10 demo recording, one response named a document ID outside the current input set. Source validation stopped that response with `document_missing`. The request schema now enumerates the prepared document IDs for every candidate's `document_id`, tying the model's source choices to the current request.

The adapter also checks carrier claim receipt against an explicit carrier acknowledgment of the freight claim. Inspection-only date assignments are omitted during semantic validation. The public scan example labels its original 31-candidate source run and its 30-candidate reviewed set separately; carrier receipt remains an individually reviewed, evidence-backed event.

## v0.4 film run and open-field review

The recorded live film request processed eight original synthetic files, sent seven text-bearing records, and returned **32 source-matched candidates in 11.173 seconds**. The browser reviewer selected all 27 required fields, approved the **$750** demand, and downloaded **22 files with all eight originals**. The filing state remains **awaiting carrier submission**.

The preceding successful request returned 31 candidates and left the explicit zero allowance as an open question, covering 26 of 27 required fields. The application keeps that field open for a source-linked manual selection. This observation accompanies the full-coverage film run. Reviewer selection establishes field meaning; the quote matcher establishes the exact source location.

The one-click hosted scan case uses a separate v0.3 request: 31 source-matched candidates, with the inspection-date-to-claim-receipt assignment removed during semantic review. Its **30 published candidates** cover all 27 required fields. The interface labels the recorded origin and the single omitted candidate.
