# Changelog

## 0.2.0 (2026-11-25)

- VGI protocol 3.4: bump @query-farm/vgi to 0.52 and @query-farm/vgi-rpc to 0.30. **Requires the
  3.4 vgi extension**: DuckDB 2.0 (`INSTALL vgi FROM query_farm`) or Haybarn 2.0.1+; Haybarn 2.0.0
  still serves the 3.3 extension, which cannot attach this worker.
- The Docker image supports Orchard hosted mode (`VGI_ORCHARD_HOSTED=1`): HTTP only, Orchard Pass
  authentication, large values through the Orchard blob vendor.
- CI and `make` run the SQL tests on haybarn-unittest 2.0.1rc3.

## 0.1.3 (2026-11-16)

- Bump @query-farm/vgi to 0.50.1.
- CI tooling (haybarn-unittest, lint helpers) runs on Python 3.14.

## 0.1.2 (2026-11-14)

- Docs link to upstream sources: the catalog docs now link the Open Graph protocol, oEmbed and
  the WHATWG HTML `<meta>` element (vgi-lint VGI183).
- The `main` schema comment is now a one-line summary; its Markdown docs no longer repeat it
  (vgi-lint VGI102).

## 0.1.1 (unreleased)

- The catalog comment is now one plain-text sentence (under 300 characters) describing the worker's data, instead of the Markdown overview. The full overview remains in the catalog's `vgi.doc_md` and `vgi.doc_llm` tags.

## 0.1.0 (2026-11-14)

- `parse_opengraph(html)` / `parse_opengraph(html, base_url)`: Open Graph / Twitter Card / HTML
  summary as a `STRUCT`, with fallbacks and URL resolution.
- `opengraph_tags(html)`: every `<meta>` property/content pair.
- `fetch_opengraph(url)`: fetch pages (redirects, head-only read, charset detection, retries,
  bounded concurrency) with per-row `http_status` and `error`.
- Composed example queries combining `parse_opengraph` and `opengraph_tags` (preview cards,
  title-source audit), plus a portable metadata audit notebook.

Targets: @query-farm/vgi 0.50 · VGI protocol 3.3 · Haybarn 2.0.0rc11 · vgi-lint-check 2.x (unpinned).
Generated from vgi-starter-typescript c1f6d0b.
