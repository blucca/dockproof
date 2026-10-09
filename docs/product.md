# DockProof — a traceable freight claim

## Buyer and job

A small manufacturer or wholesaler receives a visibly damaged LTL shipment.
The traffic coordinator has a delivery receipt, an invoice, and several emails.
They need a claim amount with a complete explanation and a packet the shipper can review and file.

DockProof connects each amount to its document, shows which carrier terms drive the calculation,
and turns the remaining evidence questions into specific requests.

## First complete story

1. Open a fictional XPO US domestic LTL case. Its inherited worksheet asks for $5,000, using the entire shipment's weight.
2. Inspect the original invoice, signed delivery record, bill of lading, and salvage offer.
3. Receive a warehouse reply identifying the damaged crate's 200 lb weight.
4. Receive the booking terms and choose the matching service scenario.
5. Inspect the $880 evidenced loss and the $1,000 standard-tariff reference limit, each with document and rule links.
6. Review the proposed $880 demand and export a packet containing the letter, evidence, valuation, and source manifest.
7. Switch the example to a spot quote. The reference limit changes to $200 and the prior review is cleared.

The fixture is an original, conspicuously labeled fictional teaching example.
The live source rules are XPO's published tariff and 49 CFR Part 1005.
The first supported scope is new goods, visible damage recorded on delivery, US domestic XPO LTL,
the explicitly supported freight classes, and a confirmed standard-tariff or spot-quote basis.

## Model role

NVIDIA Nemotron on Nebius Token Factory extracts candidate facts with document IDs and exact quotes.
The shared JavaScript engine handles arithmetic, dates, missing evidence, and review invalidation.
A shipper reviews the selected facts and filing amount. Export assembles their evidence packet.

The first public revision uses curated example facts. Live model execution will be recorded after account activation.
The adapter accepts extracted document text; a subsequent document-intake milestone adds PDF parsing and a fact-review screen.

## Delivery sequence

- Working deterministic case, source trace, reviewer flow, complete export, public example.
- Actual NVIDIA structured extraction with citation review and a user-provided document path.
- A practitioner-operated case, carrier-specific gap request, and a short narrated demo.
- Public source, hosted build, and a short narrated product demo.
