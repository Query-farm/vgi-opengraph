# OpenGraph metadata examples

- [01 · A filled preview summary can hide metadata problems](01_audit_fallbacks_before_publishing_previews.ipynb) preserves the nine-page audit: title fallbacks, conflicting titles, first-image properties, relative URLs and an explicit selection rule. [Open in Colab](https://colab.research.google.com/github/Query-farm/vgi-opengraph/blob/main/notebooks/01_audit_fallbacks_before_publishing_previews.ipynb).
- [02 · Keep fetch outcomes before selecting previews](02_keep_fetch_outcomes_before_selecting_previews.ipynb) uses an authored loopback HTTP site to distinguish redirects, missing metadata, response errors and missing URLs. [Open in Colab](https://colab.research.google.com/github/Query-farm/vgi-opengraph/blob/main/notebooks/02_keep_fetch_outcomes_before_selecting_previews.ipynb).

Choose **Runtime → Run all** in Colab. The visible base-package bootstrap retains
compatible preloaded libraries and retrieves immutable SHA256-verified companions.
For local execution, install [uv](https://docs.astral.sh/uv/) and run inside `notebooks/`:

```sh
uv sync --locked
uv run --locked vgi-notebooks
uv run --locked vgi-notebooks 01_audit_fallbacks_before_publishing_previews.ipynb --parameters '{"REQUIRE_OG_TITLE":true}' --output-dir artifacts/strict-title
uv run --locked vgi-notebooks 02_keep_fetch_outcomes_before_selecting_previews.ipynb --parameters '{"REQUIRE_DIRECT":true}' --output-dir artifacts/direct-only
```

For Jupyter select `.venv/bin/python`. The local `[runner]` extra and lock preserve
publication versions; overrides require a separate destination, unknown names fail,
and a failed execution cannot replace the last successful default. If older setup
code replaced kernel libraries, open the current notebook in a fresh runtime.

Visible SQL starts the native release:

```sql
INSTALL vgi FROM community;
LOAD vgi;
ATTACH 'opengraph' (TYPE vgi, LOCATION 'github-auto://Query-farm/vgi-opengraph@v0.1.0');
```

The extension selects the platform archive, verifies its SHA256 and caches the
worker. No local worker checkout, source build or Bun installation is required.
Initial extension/package/release/companion retrieval needs internet. The analysis
uses authored stored HTML or loopback HTTP only. It needs no credentials; shared
connection setup isolates persistent SQL secrets. The lock uses Haybarn 2.0.0rc11,
verified on macOS arm64. Other published worker platforms were not executed.
Recheck catalogs, defaults and experiments before changing the release pin.

The [shared v0.3.22 standard](https://github.com/Query-farm/vgi-example-notebooks/blob/v0.3.22/docs/standard.md)
provides proper catalog title/subtitle, branding, SVG presentation and execution
protections. Keep `charts/` beside saved notebooks for GitHub image links; interactive
runs retain native SVG. Review PNGs, logs and experiment copies are ignored.
Hosted Colab was not manually operated; a fresh compatible kernel with eight
libraries already imported exercises the base-only bootstrap.

## Complete surface coverage

Both examples together cover **3 of 3 public named surfaces**: `parse_opengraph`
(two overloads count once), `opengraph_tags` and `fetch_opengraph`. Complete actual
runtime exports show four scalar rows, no catalog tables and no views. Full returned
STRUCT/LIST schemas and arguments are recorded under `coverage/`.

Release v0.1.0 and the reviewed current public main are the identical source commit
`cb0d5e1f4c0e85e4c63992120ee5a63324671c2f`. `coverage.json` binds reviewed
SQL/narrative/results to execution receipts and both catalog snapshots. The notebooks
execute the release; compatible current mappings do not imply a separate current-main
launch. Existing green [source CI](https://github.com/Query-farm/vgi-opengraph/actions/runs/43614749896)
is reused. Source and root dependencies are unchanged; no rebuild, full-suite repetition,
source/container CI dispatch or new worker release is performed for these examples.

## Inputs and interpretation

The original `fixtures/pages.json` bytes are preserved. Its nine synthetic page
records include complete Open Graph metadata, Twitter/HTML fallbacks, conflicting
OG titles, ordered images, an absolute HTML base, missing image metadata, NULL HTML
and supplied HTML without metadata. `example.test` URLs are invented identifiers.
The source hash and parsed-result fingerprint are shown. No pages or images are
fetched in notebook 01.

The parser retains the first nonblank property after entity decoding and whitespace
normalization. Later distinct titles remain in raw tags. Image roots and their
structured properties stay together; the first image is not necessarily the largest.
The `images` list contains OG images, while a Twitter fallback may fill singular
`image` without adding an OG image. URL resolution constructs strings; it does not
establish resource availability or canonical identity.

The base selection requires title, description, image URL and page URL, with no
conflicting distinct OG titles. `REQUIRE_OG_TITLE=True` additionally requires an
explicit nonblank OG title, changing accepted page records from five to three while
the parsed fingerprint and image/conflict evidence remain unchanged. Missing HTML
remains unavailable; supplied empty-metadata
HTML remains auditable. This limited policy does not establish full Open Graph
compliance, type-specific requirements, actual image dimensions or platform rendering.

Notebook 02's `requests.json` declares nine URL input rows. `responses.json` declares
six local paths, with one redirect target. A short companion server binds only to
`127.0.0.1` on an available port, records every received path and closes at cleanup.
The worker's real HTTP implementation reads that server. No fallback or intercepted
HTTP response replaces the worker. Party/page identifiers, metadata and response
bodies are authored synthetic data; the non-HTML case deliberately uses text bytes
under an image content type, without claiming a valid image.

The scalar call is materialized once before display. Observed request accounting
must equal six requests, one per authored path: two identical input URLs share the
`/article` request in this batch, while `/go` and `/final/story` require two requests.
Malformed, unsupported and NULL inputs generate no HTTP requests. These observations
do not imply global deduplication across batches or queries. No card image is fetched.

The final HTTP status after the redirect is 200; intermediate 302 is recorded by
the fixture's declared response, not returned as a separate worker row. A 200 page
without metadata is distinct from a 404 rejection. A 200 non-HTML response still
has an error. Relative metadata URLs resolve against the final URL. `LOCAL` replaces
the ephemeral host/port only for display and comparison.

Default `REQUIRE_DIRECT=False` selects three title-bearing input rows, including
two rows for the same direct URL. True selects two: the redirect moves into review.
All nine responses and six observed requests remain fixed. This is an illustrative
selection rule, not a claim that redirects are unsafe or direct titles trustworthy.
The local fixture does not exercise TLS, every charset, response-size limits,
network outages or the retry/backoff policy; live sites can change independently.

`fixtures/provenance.json` verifies all input bytes and records their authored
origin. The worker's BSD Zero Clause license is bundled. No real website records,
private data, credentials or real writes are included.
