# Project provenance

BigAl Terminal Lab is a standalone portfolio edition of the BigAl terminal interface. Its layout starts from the latest local terminal revision, `3f08e1a` (April 20, 2026), rather than the older single-file dashboard.

The resizable, two-column workspace and panel error-boundary pattern retain the original interface's structure. This edition adds accessible panel controls, keyboard resizing, a responsive layout, and panel choices driven by the actual registry.

The chart and data paths are reconstructed for this edition. Charts use explicit input observations and documented aggregation rules. They do not inherit the earlier implementation's random candle wicks, estimated volume, or synthetic timestamps. Missing measurements remain unavailable rather than being represented as observed data.

Typography uses openly licensed replacement fonts. The original branded font binaries are not included; the replacement fonts' licenses accompany their assets.

This repository is a fresh export. It contains no inherited Git history, runtime records, credentials, execution backend, or account integrations. Included example observations are synthetic fixtures created for the public demonstration. No subscription service is required to run the local demo.

The source revision establishes interface provenance. It is not a claim that the earlier application, external services, or execution behavior has been validated by this project. Validation here applies to the source and checks documented in this repository.
