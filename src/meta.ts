/**
 * Discovery metadata: the one file to edit when you rename or extend the worker.
 *
 * DuckDB, coding agents and the `vgi-lint` metadata checker all read these
 * tags. Keep every object documented and `make lint-explain` stays at 100.
 *
 * - Catalog-level tags (title, license, author, links, long description) live in
 *   `CATALOG_TAGS` below.
 * - Every function carries `objectTags(...)`: a title, a category from
 *   `SCHEMA_CATEGORIES`, search keywords, and LLM- and human-facing docs.
 */

import { field, type VgiDataType, type VgiField } from "@query-farm/vgi";

export const CATALOG_NAME = "opengraph";
export const VERSION = "0.1.0";

export const SOURCE_URL = "https://github.com/Query-farm/vgi-opengraph";

/**
 * Categories group functions in docs and agent tools. Every object's
 * `vgi.category` must name one of these.
 */
export const SCHEMA_CATEGORIES = [
  { name: "parse", title: "Parse HTML", description: "Extract metadata from HTML text you already have; no network." },
  { name: "fetch", title: "Fetch URLs", description: "Download web pages over HTTP(S) and extract their metadata." },
] as const;

export type Category = (typeof SCHEMA_CATEGORIES)[number]["name"];

/** Turn `"a, b, c"` into the JSON array string `vgi.keywords` requires. */
export function keywordsArray(keywords: string): string {
  return JSON.stringify(
    keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

/** Build the standard per-object discovery tags. */
export function objectTags(opts: {
  title: string;
  category: Category;
  keywords: string;
  docLlm: string;
  docMd: string;
}): Record<string, string> {
  return {
    "vgi.title": opts.title,
    "vgi.category": opts.category,
    "vgi.keywords": keywordsArray(opts.keywords),
    "vgi.doc_llm": opts.docLlm,
    "vgi.doc_md": opts.docMd,
  };
}

/** Build an Arrow field whose `comment` shows up in DuckDB's `DESCRIBE` and agent tools. */
export function column(name: string, type: VgiDataType, comment: string, nullable = true): VgiField {
  return field(name, type, nullable, new Map([["comment", comment]]));
}

export const CATALOG_DOC_LLM =
  "Link-preview metadata for DuckDB: parse the Open Graph protocol (og:title, og:image, og:type, " +
  "…), Twitter Card tags and plain HTML fallbacks (<title>, <meta name=description>, " +
  "<link rel=canonical>, favicon, oEmbed discovery) out of web pages. Two ways in: give it HTML " +
  "text you already hold (a crawl table, read_text() over saved pages, an HTTP response column) " +
  "and it parses locally with no network access; or give it URLs and it downloads each page's " +
  "head, follows redirects, and reports per-row HTTP status and errors instead of failing the " +
  "query. Results are `STRUCT`s (use dot access, e.g. `.title`) or a list of raw property/content " +
  "pairs for anything outside the summary. Reach for it to unfurl links, enrich URL columns with " +
  "titles and preview images, audit social-sharing tags, or extract article:* / product:* metadata.";

export const CATALOG_DOC_MD =
  "# Open Graph metadata for DuckDB\n\n" +
  "**Parse [Open Graph](https://ogp.me), Twitter Card and HTML link-preview metadata in SQL**, " +
  "from HTML text or straight from URLs.\n\n" +
  "- Parse HTML you already have (crawl tables, saved pages) with no network access.\n" +
  "- Or fetch pages directly: redirects followed, only the `<head>` read, failures reported per " +
  "row in an `error` field.\n" +
  "- Sensible fallbacks: missing `og:*` tags fall back to `twitter:*`, then `<title>`, " +
  "`<meta name=description>` and `<link rel=canonical>`.\n" +
  "- Relative image and page URLs resolved to absolute ones.\n\n" +
  "A [Query.Farm](https://query.farm) [VGI](https://query.farm/vgi) worker.";

export const SCHEMA_DOC_LLM =
  "The `main` schema holds the Open Graph functions. The parse category works on HTML text with " +
  "no network: a summary `STRUCT` of a page's preview metadata (optionally resolving relative URLs " +
  "against the page URL), or the full list of <meta> property/content pairs for unnest-and-filter " +
  "work. The fetch category downloads pages by URL and returns the same summary plus final_url, " +
  "http_status, content_type and error; a bad URL yields an error value, not a failed query. All " +
  "are scalars over whole columns, so they compose with any table of HTML or URLs.";

export const SCHEMA_DOC_MD =
  "## main\n\n" +
  "Open Graph / Twitter Card / HTML link-preview metadata extraction, as vectorized scalars " +
  "that run over a whole column.\n\n" +
  "- **Parse**: from HTML text you already hold (crawl tables, saved pages), offline. Returns a " +
  "summary `STRUCT`, or every `<meta>` property/content pair as a list.\n" +
  "- **Fetch**: from URLs over HTTP(S), following redirects and reading only the `<head>`. " +
  "Failures come back in an `error` field instead of failing the query.";

export const AGENT_TEST_TASKS = [
  {
    name: "og_title_from_html",
    prompt:
      "Using the opengraph worker, what is the Open Graph title of this HTML: " +
      '<head><title>Home</title><meta property="og:title" content="Spring Sale"></head>',
  },
  {
    name: "absolute_image",
    prompt:
      'A page at https://shop.example.com/items/42 contains <meta property="og:image" ' +
      'content="../img/42.jpg">. Using the opengraph worker, what is the absolute URL of its preview image?',
  },
  {
    name: "count_meta_properties",
    prompt:
      "Using the opengraph worker, how many article:tag meta properties does this HTML have: " +
      '<meta property="article:tag" content="duckdb"><meta property="article:tag" content="sql">' +
      '<meta property="og:type" content="article">',
  },
  {
    name: "latest_article_title",
    prompt:
      "Using the opengraph worker, which of these two article pages was published most recently " +
      "(by article:published_time)? Return its link-preview title as a single column named title. " +
      'Page 1: <meta property="og:title" content="Duck Season"><meta property="article:published_time" ' +
      'content="2026-03-01T09:00:00Z">  Page 2: <title>Pond Notes</title><meta property="article:published_time" ' +
      'content="2026-05-20T12:30:00Z">',
  },
  {
    name: "fetch_page_title",
    prompt: "Using the opengraph worker, fetch https://example.com and report the page's title.",
  },
];

export const CATALOG_TAGS: Record<string, string> = {
  "vgi.title": "Open Graph Metadata",
  "vgi.subtitle": "Parse Open Graph, Twitter Card and HTML link-preview metadata from HTML text or URLs.",
  "vgi.doc_llm": CATALOG_DOC_LLM,
  "vgi.doc_md": CATALOG_DOC_MD,
  "vgi.source_url": SOURCE_URL,
  "vgi.icon_url": "https://query.farm/media-kit/products/vgi/vgi-logo.png",
  "vgi.license": "0BSD",
  "vgi.author": "Query.Farm",
  "vgi.copyright": "Copyright 2026 Query Farm LLC - https://query.farm",
  "vgi.keywords": keywordsArray(
    "open graph, opengraph, twitter card, link preview, unfurl, meta tags, html, web scraping, duckdb",
  ),
  "vgi.support_contact": `${SOURCE_URL}/issues`,
  "vgi.support_policy_url": `${SOURCE_URL}#support`,
  // Public analyst tasks for `vgi-lint simulate`; private graders live in vgi-agent-tests.yaml.
  "vgi.agent_test_tasks": JSON.stringify(AGENT_TEST_TASKS),
};

export const SCHEMA_TAGS: Record<string, string> = {
  "vgi.title": "Open Graph Functions",
  domain: "web",
  "vgi.keywords": keywordsArray("open graph, og:image, og:title, twitter card, meta tags, link preview, fetch url"),
  "vgi.doc_llm": SCHEMA_DOC_LLM,
  "vgi.doc_md": SCHEMA_DOC_MD,
  "vgi.categories": JSON.stringify(SCHEMA_CATEGORIES),
};
