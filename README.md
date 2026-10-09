# DockProof

**Every claim dollar, traced.**

[Try the PDF case](https://blucca.github.io/dockproof/?case=import-example) · [Bring your documents](https://blucca.github.io/dockproof/?case=own) · [Rule sources](docs/sources.md)

One damaged shipping piece. An invoice, a delivery receipt, and a worksheet using the whole shipment's weight.

DockProof brings those records to one desk: **read the source, resolve conflicting facts, reconcile the amount, and hand over a shipper-reviewed packet with the original files.**

## Try the complete document path

The **PDF example** reads six original synthetic records in your browser, including a two-page bill of lading / delivery receipt and a PDF invoice.

1. Inspect the candidate values and their exact page / line excerpts.
2. Select the single-value fields. The conflicting weight stays open for your decision.
3. Choose **150 lb for B4** from the packing sheet. The inherited worksheet's **600 lb** stays in the evidence record.
4. Follow **$2,000 − $100 discount − $175 retained salvage = $1,725** in evidenced loss.
5. Review the **$750** class-70 reference limit and proposed demand.
6. Download the **18-file packet**, including all six originals, source-text copies, valuation, references, and a SHA-256 original-file manifest.

The original **Guided example** explores a separate C3 claim: a $5,000 worksheet, $880 supported demand, missing-record requests, and a $200 spot-quote branch. Each example and **My claim** has its own browser-local saved workspace.

![DockProof's evidence-linked claim workspace](web/preview.png)

## Bring a shipment to the desk

Open **My claim** on the hosted page or your local server:

1. Add selectable-text PDFs or UTF-8 records (`.txt`, `.md`, `.csv`, `.eml`), or paste an email / transcript.
2. Assign record roles: bill of lading, delivery receipt, invoice, inspection / salvage, piece weight, or booking terms. One PDF can serve several roles.
3. Use **Record a sourced value** to select an exact excerpt and its value. A connected NVIDIA Nemotron model can propose candidates for the whole document set.
4. Resolve conflicting values and review the calculation. The same deterministic engine handles both paths.
5. Approve the current evidence snapshot and download the packet for your carrier filing process.

Every required identity, valuation, and scope field needs a source-linked selection. A changed fact, document, or role opens a fresh review. Earlier selections retain their values, source excerpts, and reasons.

### Documents and storage

- PDF text extraction runs locally using self-hosted **PDF.js 6.4.299**. Pages and lines retain exact UTF-16 positions in the extracted text.
- Original PDF / text bytes stay in **IndexedDB**; extracted text, selections, and review state stay in browser-local storage. Reload restores both. Downloads check original-file SHA-256 against the imported record.
- Limits: **12 records**, **10 MB per file**, **25 MB combined**, **40 pages per PDF**, and **80,000 extracted text characters per case**.
- Image-only pages request a searchable PDF or a separate UTF-8 transcript. A transcript carries its own source identity and citations.
- The hosted application supports importing, manual review, calculation, and export. **Extract with Nemotron** sends the selected case's document text through your local server to your Nebius account.

## Run locally

Requires **Node.js 22+**. The server and claim engine use native APIs; the browser PDF parser is vendored with its Apache-2.0 license and provenance.

```sh
git clone https://github.com/blucca/dockproof.git
cd dockproof
npm start
```

Open **http://127.0.0.1:4318/**. Document import, manual source selection, and both examples are ready immediately.

For NVIDIA Nemotron candidate extraction, set your local server environment:

```sh
export NEBIUS_API_KEY='your-key'
export NEBIUS_MODEL='nvidia/nemotron-3-super-120b-a12b'
export NEBIUS_BASE_URL='https://api.tokenfactory.us-central1.nebius.com/v1'
npm start
```

In **My claim → Documents & facts**, add the documents and choose **Extract with Nemotron**. The adapter requests `response_format.json_schema`, validates field types and exact source positions, and returns candidate facts and evidence questions. You select the values that enter the claim engine. The browser retains the provider model, duration, request ID, and reported usage with the case. API credentials stay in the server environment; the server handles document text in memory.

**Provider status for v0.2:** the NVIDIA adapter and controlled-response integration checks are implemented. Live-provider execution is the next account-activation milestone. The published PDF example uses **curated candidates**, labeled `sample_curated`, and actual browser PDF parsing.

The endpoint also accepts extracted text directly:

```sh
curl http://127.0.0.1:4318/api/extract \
  -H 'Content-Type: application/json' \
  --data '{"documents":[{"id":"weight","name":"Warehouse weight sheet","text":"Crate B4 actual gross weight: 150 lb."}]}'
```

## Rule scope

The calculation covers **XPO US interstate LTL**, **new ordinary goods**, **one visibly damaged shipping piece**, a documented actual freight class, direct shipper terms, and a standard-tariff or spot-quote basis. The selected rule version is **CNWY 199-AK.3, effective August 17, 2026**.

Special commodities, used goods, broker terms, purchased excess-value agreements, and concealed damage enter a separate terms review. Shipment-specific selections establish the applicable scope. The three amounts remain distinct: **evidenced loss**, **tariff reference limit**, and **requested demand**.

The filing deadline uses delivery plus **nine calendar months** and tracks **carrier receipt**. Export prepares the filing packet. Receipt and payment are subsequent events recorded from their own evidence. [See the official source mapping](docs/sources.md).

Both public examples contain conspicuously synthetic companies, shipment identifiers, records, and values. **My claim** begins with an empty evidence and fact set.

## Architecture

```text
web/data/import-example/      Original PDF/text example + curated candidates
web/data/sample-case.json     Guided missing-evidence example
web/core/document-intake.mjs  PDF/text reading, pages, hashes, original storage
web/core/fact-review.mjs      Typed fields, exact citations, reviewer selections
web/core/case-engine.mjs      Deterministic valuation, scope, deadlines, packet
web/core/zip.mjs              UTF-8 and binary ZIP writer
web/intake-ui.mjs             Import, source selection, candidate review
web/app.mjs                   Isolated workspaces, evidence desk, export
src/nebius.mjs                NVIDIA structured extraction and source validation
src/server.mjs                Local static server and extraction endpoint
```

```sh
npm test
```

Focused checks cover the core calculation, source selection, changed-evidence review, exact citation positions, document parsing, and provider response validation. Browser acceptance covers the PDF-to-packet path, conflicting weight selection, page-two citations, manual entry, original-byte export after reload, and a 390 px layout.

Built by [Blucca](https://github.com/blucca) with autonomous AI development assistance. MIT application code and original synthetic records. PDF.js retains its upstream Apache-2.0 license in [`web/vendor/pdfjs/`](web/vendor/pdfjs/).
