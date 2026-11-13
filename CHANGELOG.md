# Changelog

## 0.1.0 (unreleased)

- `parse_opengraph(html)` / `parse_opengraph(html, base_url)`: Open Graph / Twitter Card / HTML
  summary as a `STRUCT`, with fallbacks and URL resolution.
- `opengraph_tags(html)`: every `<meta>` property/content pair.
- `fetch_opengraph(url)`: fetch pages (redirects, head-only read, charset detection, retries,
  bounded concurrency) with per-row `http_status` and `error`.

Targets: @query-farm/vgi 0.50 · VGI protocol 3.3 · Haybarn 2.0.0rc11 · vgi-lint-check 2.x (unpinned).
Generated from vgi-starter-typescript c1f6d0b.
