# SmartDoc camera frames — attribution and provenance

**ICDAR 2015 SmartDoc Challenge 1**, original version 1.0.0. Source: [Zenodo record and sample archive](https://zenodo.org/records/1230218), DOI [10.5281/zenodo.1230218](https://doi.org/10.5281/zenodo.1230218).

**License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)** ([legal code](https://creativecommons.org/licenses/by/4.0/legalcode)). The original Zenodo record licenses the sample archive under CC BY 4.0; the [dataset author's repository](https://github.com/jchazalon/smartdoc15-ch1-dataset) also explicitly applies that license to the associated dataset.

**Attribution:** Jean-Christophe Burie, Joseph Chazalon, Mickaël Coustaty, Sébastien Eskenazi, Muhammad Muzzamil Luqman, Maroua Mehri, Nibal Nayef, Jean-Marc OGIER, Sophea Prum and Marçal Rusinol: “ICDAR2015 Competition on Smartphone Document Capture and OCR (SmartDoc)”, In 13th International Conference on Document Analysis and Recognition (ICDAR), 2015.

## Capture and publication

The authors printed a technical datasheet on A4 paper and filmed it handheld using a Google Nexus 7. The source member is `sampleDataset/input_sample/background00/datasheet001.avi` within [`sampleDataset.tar.gz`](https://zenodo.org/records/1230218/files/sampleDataset.tar.gz?download=1).

DockProof research selected zero-based frames **10, 22, 110 and 154** from that video, using sequential OpenCV video decoding from frame 0 and lossless PNG encoding at native 1920×1080 resolution. Nominal frame times use the stream's 22 fps. Per-image hashes, video hash, source links and frame provenance are in [provenance.json](provenance.json).

Frame 10 is a naturally blurred view; frame 22 is a subsequent readable view of the same sheet. Frames 110 and 154 provide two more naturally blurred observations from the same video. In the recorded local workflow, a scripted uploader selects these existing observations in response to capture requests. The field review records the printed `Power Dissipation: 300 mW` from frame 22.

The `evidence/review.png` screenshot contains these attributed camera frames and their OpenCV perspective-corrected derivative. Perspective transformations and output hashes are recorded in the experiment's JSON results. Synthetic shipping-label captures are generated separately from DockProof's MIT-licensed demonstration label.
