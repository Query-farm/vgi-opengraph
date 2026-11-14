<p align="center">
  <img src="https://query.farm/media-kit/products/vgi/vgi-logo.png" alt="Vector Gateway Interface (VGI)" width="320">
</p>

<p align="center"><em>A Query.Farm VGI worker for DuckDB.</em></p>

# Parse Open Graph, Twitter Card & Link-Preview Metadata in DuckDB

> **vgi-opengraph** · a [Query.Farm](https://query.farm) VGI worker · written in TypeScript

[![CI](https://github.com/Query-farm/vgi-opengraph/actions/workflows/ci.yml/badge.svg)](https://github.com/Query-farm/vgi-opengraph/actions/workflows/ci.yml)
[![vgi worker: query.farm](https://query.farm/media-kit/shields/vgi-worker.svg)](https://query.farm)

Every link preview in a chat app comes from a handful of `<meta>` tags: the
[Open Graph protocol](https://ogp.me) (`og:title`, `og:image`, …), Twitter Cards, and
plain HTML (`<title>`, `<meta name="description">`, `<link rel="canonical">`). This worker
reads them in SQL, either from **HTML text you already have** or **straight from URLs**.

```sql
SELECT og.title, og.site_name, og.image
FROM (SELECT opengraph.main.fetch_opengraph('https://github.com/duckdb/duckdb') AS og);
-- GitHub - duckdb/duckdb: DuckDB is a high-performance analytical database system | GitHub | https://repository-images.githubusercontent.com/…
```

| Function | Returns | Network |
|---|---|---|
| `parse_opengraph(html)` | `STRUCT` summary (below) | no |
| `parse_opengraph(html, base_url)` | same, with relative URLs made absolute | no |
| `opengraph_tags(html)` | `LIST(STRUCT(property, content))`: every `<meta>` tag, in order | no |
| `fetch_opengraph(url)` | the summary plus `final_url`, `http_status`, `content_type`, `error` | yes |

All four are vectorized scalars: they run over a whole column of HTML or URLs.

### The summary `STRUCT`

| Field | Source, in order of preference |
|---|---|
| `title` | `og:title` → `twitter:title` → `<title>` |
| `description` | `og:description` → `twitter:description` → `<meta name="description">` |
| `type`, `site_name` | `og:type`, `og:site_name` |
| `url` | `og:url` → `<link rel="canonical">` |
| `locale` | `og:locale` → `<html lang>` |
| `image`, `image_alt`, `image_width`, `image_height` | first `og:image` (with its `:url`, `:secure_url`, `:alt`, `:width`, `:height`) → `twitter:image` |
| `images` | every `og:image`, in document order (`VARCHAR[]`) |
| `video`, `audio` | `og:video`, `og:audio` |
| `twitter_card`, `twitter_site`, `twitter_creator` | `twitter:*` |
| `canonical_url`, `favicon_url`, `oembed_url` | `<link rel="canonical">`, `<link rel="icon">` (→ `apple-touch-icon`), oEmbed JSON discovery link |

The first occurrence of a property wins. Values are entity-decoded and whitespace-trimmed;
missing values are `NULL`. With a base URL (or for `fetch_opengraph`, the URL after redirects),
and honouring any `<base href>`, URL fields are absolute.

## Quick start

**Prerequisites:** [Bun](https://bun.sh) 1.3+.

```bash
git clone https://github.com/Query-farm/vgi-opengraph.git && cd vgi-opengraph
bun install --frozen-lockfile
```

**DuckDB 2.0:**

```sql
SET allow_extension_repositories = 'allowed';
CREATE EXTENSION REPOSITORY IF NOT EXISTS query_farm WITH PREFIX 'https://duckdb-extensions.query.farm';
INSTALL vgi FROM query_farm;
LOAD vgi FROM query_farm;
ATTACH 'opengraph' (TYPE vgi, LOCATION '/abs/path/to/vgi-opengraph/bin/vgi-opengraph-worker');
```

**Haybarn 2.0** (`uvx haybarn-cli`):

```sql
INSTALL vgi FROM community;
LOAD vgi;
ATTACH 'opengraph' (TYPE vgi, LOCATION '/abs/path/to/vgi-opengraph/bin/vgi-opengraph-worker');
```

Use an absolute path: `LOCATION` is the command DuckDB runs, resolved against its working
directory. Release builds are standalone executables (no Bun needed); point `LOCATION` at
the downloaded binary instead.

## Examples

**Unfurl a column of links.** URLs in a batch are fetched concurrently; duplicates are fetched once.

```sql
SELECT url, og.title, og.image, og.http_status, og.error
FROM (SELECT url, opengraph.main.fetch_opengraph(url) AS og FROM read_csv('links.csv'));
```

A page that can't be read doesn't fail the query: its row has `error` set (`HTTP 404 Not
Found`, `timed out after 10000 ms`, `not an HTML page (content type image/png)`, …) and
`NULL` metadata.

**Parse HTML you already crawled**, resolving relative image URLs against each page's URL:

```sql
SELECT page_url, og.title, og.image
FROM (SELECT page_url, opengraph.main.parse_opengraph(body, page_url) AS og FROM crawl)
WHERE og.image IS NOT NULL;
```

**Saved pages on disk:**

```sql
SELECT filename, opengraph.main.parse_opengraph(content).title
FROM read_text('pages/*.html');
```

**Anything outside the summary** (`article:*`, `product:*`, `og:locale:alternate`, …):

```sql
SELECT t.property, t.content
FROM (SELECT unnest(opengraph.main.opengraph_tags(body)) AS t FROM crawl)
WHERE t.property LIKE 'article:%';
```

**Combine the summary with raw tags**: preview cards for crawled articles, with the
`article:tag` keywords the summary doesn't carry:

```sql
SELECT page_url, og.title, og.image, article_tags
FROM (SELECT page_url,
             opengraph.main.parse_opengraph(body, page_url) AS og,
             [t.content FOR t IN opengraph.main.opengraph_tags(body) IF t.property = 'article:tag'] AS article_tags
      FROM crawl)
ORDER BY page_url;
```

**Audit social-sharing tags across a site:**

```sql
SELECT count(*) FILTER (WHERE og.image IS NULL) AS missing_image,
       count(*) FILTER (WHERE og.twitter_card IS NULL) AS missing_card
FROM (SELECT opengraph.main.fetch_opengraph(url) AS og FROM sitemap_urls);
```

## Fetching

`fetch_opengraph` follows redirects, reads each response only up to `</head>` (Open Graph
tags live there), decodes the charset from `Content-Type` or `<meta charset>`, and retries
`429`/`502`/`503`/`504` twice, honouring `Retry-After`. Only `http://` and `https://` URLs are
fetched. Tune it with environment variables on the worker process:

| Variable | Default | Meaning |
|---|---|---|
| `OPENGRAPH_TIMEOUT_MS` | `10000` | Per-URL timeout, including redirects and retries |
| `OPENGRAPH_MAX_BYTES` | `2097152` | Most bytes read from one response |
| `OPENGRAPH_CONCURRENCY` | `8` | Parallel requests per batch |
| `OPENGRAPH_USER_AGENT` | `Mozilla/5.0 (compatible; vgi-opengraph/<version>; +https://github.com/Query-farm/vgi-opengraph)` | `User-Agent` header |

Some sites serve different (or no) metadata to unrecognized clients, or block them; that
shows up as an `error` or sparse fields.

> **Hosting it?** `fetch_opengraph` fetches whatever URL a query names, including
> addresses on the worker's own network. If you run it as a shared HTTP service, put it
> where that's acceptable or restrict its egress.

## Testing

```bash
make test-unit                 # bun unit tests (parser, charsets, fetch against a fixture site)
make test-sql                  # test/sql/*.test through DuckDB (stdio)
make test-sql TRANSPORT=http   # …over HTTP (also: launch)
make check                     # everything CI runs, including vgi-lint (100/100)
```

Everything runs offline: `fetch_opengraph` is tested against `test/fixture_site/server.py`,
which serves the pages in `test/fixtures/` plus redirects, errors, a rate-limited route, a
slow route and an endless page.

## Deploying

The same worker serves stdio (DuckDB starts it locally) or HTTP:

```bash
docker build -t vgi-opengraph .
docker run -p 8000:8000 vgi-opengraph   # health: GET /health
```

```sql
ATTACH 'opengraph' (TYPE vgi, LOCATION 'https://workers.example.com/opengraph');
```

## Releasing

Push a tag like `v0.1.0`. The release workflow compiles the worker with `bun build --compile`
into a standalone, cosign-signed executable for Linux (x86-64, arm64), macOS (arm64) and
Windows (x86-64). `ci/check-version.sh` checks the tag against `package.json`.

## Learn more

- [What is VGI?](https://query.farm/vgi) · [Building a worker](https://query.farm/vgi/building-a-worker) · [TypeScript SDK](https://query.farm/vgi/docs/typescript/)
- [The Open Graph protocol](https://ogp.me) · [AGENTS.md](AGENTS.md) for coding agents

## Support

Open an issue on this repository. For VGI itself, see [query.farm](https://query.farm).

## Authorship & License

Written by [Query.Farm](https://query.farm). Released under the
[BSD Zero Clause License](LICENSE) (0BSD).

Copyright 2026 Query Farm LLC - https://query.farm

## Executed notebook

[Audit metadata fallbacks before publishing previews](notebooks/README.md) uses synthetic HTML through the real parser, a portable pinned worker launch, and a separate policy experiment.
