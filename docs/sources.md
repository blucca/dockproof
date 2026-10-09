# Source map

Verified October 9, 2026. The selected tariff version is **CNWY 199-AK.3, effective August 17, 2026**.

| Product rule | Official source | Use in DockProof |
|---|---|---|
| Delivered US shipment: written claim received within 9 months | [XPO Item 7(11), p11](https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AK.3_Eff._08.17.2026.pdf#page=11) | Calendar-month deadline from the delivery receipt |
| Shipment identity, assertion of liability, specific demand | [49 CFR §1005.2(b)](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-X/subchapter-B/part-1005/section-1005.2#p-1005.2(b)) and XPO Item 7(11) | Three distinct elements in the claim cover letter |
| Original invoice/wholesale basis and applicable salvage | [XPO Item 25, p19](https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AK.3_Eff._08.17.2026.pdf#page=19) | Invoice-backed loss, with retained salvage deducted |
| Trade discounts, allowances, and deductions | [49 CFR §1005.4(b)](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-X/subchapter-B/part-1005/section-1005.4#p-1005.4(b)) | Separate gross, discount, allowance, and net values |
| Individual lost or damaged piece; actual class 70 at $5/lb | [XPO Item 25, p19](https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AK.3_Eff._08.17.2026.pdf#page=19) | C3's 200 lb, with the shipment's 1,000 lb retained as a distinct fact |
| Spot-quote liability basis at $1/lb; special terms | [XPO Item 25, pp19–21](https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AK.3_Eff._08.17.2026.pdf#page=19) | Explicit service selection; unsupported contract/commodity branches enter manual review |
| Vendor invoice and supporting evidence; carrier portal | [XPO filing guide](https://www.xpo.com/help-center/claims-and-refunds/how-file-claims-and-refunds/) | Packet handoff to the shipper's authenticated carrier workflow |

The [XPO tariff library](https://www.xpo.com/tariff-library/) links the current official documents. The controlling agreement and shipment date determine the version and terms for a real shipment.

## Original teaching records

`web/data/sample-case.json` contains seven original synthetic documents. The bill of lading supplies class 70 as a given case fact. The rate confirmation supplies the ordinary-new-goods, direct-shipper, selected-service conditions used by the example.

Original records remain in the packet after a corrected demand is reviewed. The UI's crate illustration is a diagram. Actual claims use the shipper's original documents, photographs, and confirmed terms.

## NVIDIA extraction references

- [Nebius Nemotron 3 Super cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-super-120B.md)
- [Nebius structured output](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
- [Nebius API quickstart](https://docs.tokenfactory.nebius.com/quickstart)

The adapter extracts candidate facts from document text. The JavaScript engine computes the selected valuation and a reviewer confirms the demand. Live model operation is the next integration milestone after account activation.
