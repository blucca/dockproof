# DockProof — project story

## Inspiration

A damaged crate arrives. An inherited worksheet asks for **$3,000**, using the entire shipment's **600 lb**. The packing record gives the damaged crate, B4, its own weight: **150 lb**. That distinction changes the claim.

Small manufacturers and wholesalers already have the invoice, delivery receipt, warehouse notes and photographs. A logistics coordinator still has to reconstruct the shipment, reconcile contradictory records, check the applicable terms and assemble a claim someone can stand behind.

**DockProof makes every claim dollar traceable—from the original record to the shipper-reviewed packet.**

## What it does

Bring PDFs, scanned pages, photos and text records to one evidence desk. Local English OCR reads the scans. **NVIDIA Nemotron Super on Nebius Token Factory** proposes typed facts and exact source excerpts. The reviewer selects the evidence, resolves conflicting values and sees the resulting calculation.

The demonstrated case follows:

- **$2,000 invoice value − $100 discount − $175 retained salvage = $1,725 evidenced loss.**
- **150 lb × $5/lb = $750 reference limit** under the selected class-70 shipment terms.
- The reviewer approves a **$750 demand** for that evidence snapshot.

DockProof produces a **22-file ZIP**: a claim letter, valuation, source/OCR text, rule references, review record and **all eight original files**, with SHA-256 fingerprints. The shipper can use the carrier's filing process. Carrier receipt and payment are recorded as subsequent evidence-backed events.

## How we built it

The browser uses self-hosted **PDF.js** for selectable text and **Tesseract.js** for English OCR. Each page keeps its extraction method, page/line locations and original-file hash. IndexedDB preserves original bytes; browser-local workspaces preserve selections and review state.

A lightweight **Node.js** service calls `nvidia/nemotron-3-super-120b-a12b` through Nebius Token Factory's OpenAI-compatible inference API. Its structured schema has **33 typed field slots**, up to three candidate values per field, exact quotations and focused evidence questions. The application matches each quote to the source text.

A shared JavaScript engine performs whole-cent valuation, calendar-month deadlines, shipment-scope checks and version-linked approval. Changes to evidence, roles or selected facts open a fresh review. Original scans stay available beside their OCR-derived excerpts.

The current rule adapter covers **XPO US interstate LTL, new ordinary goods, one visibly damaged shipping piece, direct shipper booking, documented class and standard-tariff or spot-quote terms**. Sources include XPO's CNWY 199-AK.3 tariff and 49 CFR Part 1005, with specific references exposed in the product.

## Challenges we ran into

Source location and field meaning required separate controls. Early extraction repeated entries until the output ceiling. A bounded schema and typed values made the document contract tractable. An invalid source ID led to request-specific document-ID enums.

A warehouse inspection date also appeared as carrier claim receipt. We added explicit receipt-evidence validation and individual receipt review. One OCR label read `lb.` as `Ib.`; keeping the original image next to the derived text gave the reviewer the evidence needed to choose the value.

## Accomplishments that we're proud of

The **2:44 demonstration** follows a complete, real browser workflow: eight original synthetic files, local OCR, a live NVIDIA request, source review, calculation, approval and export. Its model request returned **32 source-matched candidates in 11.173 seconds**, covering all **27 required fields**. Every exported original matched its imported fingerprint.

The public scan example offers a quick start with live browser OCR and clearly labeled recorded NVIDIA candidates. The dedicated judge build provides live model extraction. The application, original sample records and source code are public.

## What we learned

A useful AI document product carries a decision all the way through: an inspectable source, a selected fact, an explicit rule, a reviewed amount and a file another person can use. That continuity became DockProof's core design.

## What's next for DockProof

Work through a genuine case with a logistics coordinator, measure preparation time and source corrections, and refine the missing-record requests. Expand carrier adapters around versioned terms and actual shipment workflows as those trials establish demand.

Built by Blucca with autonomous AI development assistance. Demonstration companies, shipments and records are original synthetic material. The film uses scripted browser reviewer actions, synthesized English narration and captions.
