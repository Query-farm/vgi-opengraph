# OpenGraph preview-audit notebook

[01 · A filled preview summary can hide metadata problems](01_audit_fallbacks_before_publishing_previews.ipynb) traces title fallbacks, conflicting titles, image order and URL resolution before applying a small publication policy. An explicit-OG-title toggle changes acceptance without changing the parsed evidence.

## Install and execute

Requires Python 3.13–3.14, [uv](https://docs.astral.sh/uv/), Git and **Bun 1.3+** (tested 1.3.14), with internet for initial package, Git and extension downloads. The analysis itself makes no page or image requests.

```sh
cd notebooks
uv sync --locked
uv run --locked python execute.py
uv run --locked python -m ipykernel install --user --name vgi-opengraph-notebooks --display-name 'Python (vgi-opengraph notebooks)'
```

Select that kernel and Restart Kernel → Run All. The runner creates a fresh temporary kernel and uses this directory as cwd. The whole directory runs independently of the worker checkout.

The literal ATTACH uses `bun run github_worker.ts Query-farm/vgi-opengraph 1f43dbfd70c2987613ccef729cc57affea112650 src/worker.ts`. No published binary release or npm package was available during validation. This immutable remote Git revision retains SDK 0.50.0, RPC 0.29.7 and Arrow 21.1.1 in its frozen Bun lockfile. Notebook Haybarn is locked to **2.0.0rc11**.

The companion verifies the fetched commit, runs `bun install --frozen-lockfile` and caches by repository, revision and Bun version under `${XDG_CACHE_HOME:-~/.cache}/vgi-notebook-workers`. Setup uses a bounded lock and atomic publication; the ready marker is checked before execution. All installation messages go to stderr, preserving Arrow stdout; worker arguments pass through. No source patch or local source discovery is involved. Revalidate the notebook and experiment when changing the pin.

## One-parameter experiment

```sh
uv run --locked python execute.py --parameters '{"REQUIRE_OG_TITLE":true}' --output-dir validation/require-og
```

The default is `False`. Both policies require title, description, image URL and page URL in the summary, with no distinct conflicting OG titles. The experiment additionally requires an explicit retained nonblank `og:title`. This is an illustrative policy, not full protocol validation. It does not check `og:type`, type-specific fields, actual image dimensions, availability of resources or rendering on any social platform.

Overrides require a separate destination and unknown names fail. The saved default changes only after successful execution, atomically. Experiment copies include fixtures, launcher, branding, documentation, runner and locked environment. Audit logs, extracted charts and validation copies are ignored; the main notebook embeds successful outputs.

## Explicit synthetic inputs

`fixtures/pages.json` contains nine hand-authored records: a complete OG example, Twitter fallback, HTML-title fallback, conflicting titles, ordered images, an absolute HTML base, a missing image, NULL HTML, and supplied HTML without metadata. All `example.test` URLs are fictional identifiers; no real website or user data is included. The exact fixture hash and parsed-result fingerprint are displayed and recorded in ignored artifacts. The real worker's `parse_opengraph` and `opengraph_tags` functions process the entire corpus.

A NULL input remains unavailable. Supplied empty-metadata HTML yields an available summary with missing fields. Raw tag order is retained with ordinality; entity decoding, whitespace normalization and omission of blank content precede the first-retained-property rule. The summary prefers OG, then Twitter, then HTML for titles. A populated fallback field does not create an explicit OG tag.

The first OG image's properties stay attached to it; the worker does not choose the largest later image. The `images` array contains OG images, while a Twitter fallback can fill the singular `image` and leave that array empty. An HTML base can resolve a URL even without a supplied page URL. URL resolution only constructs strings and does not fetch or validate resources.

The [Open Graph protocol](https://ogp.me/) documents ordered image arrays and structured properties. This notebook's one title-conflict rule is deliberately narrower than full protocol or platform validation. `fetch_opengraph` is outside the notebook's computational story; the repository's required tests exercise its local fixture server, redirects, HTTP errors and bounds without crawling real sites.

[Notebook standard](STANDARD.md) · [Query.Farm](https://query.farm/) · [VGI](https://query.farm/vgi/)
