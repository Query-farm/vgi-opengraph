/**
 * The worker's SQL functions.
 *
 *   parse_opengraph(html)            -> STRUCT   summary of a page's metadata
 *   parse_opengraph(html, base_url)  -> STRUCT   same, URLs made absolute
 *   opengraph_tags(html)             -> LIST     every <meta> property/content pair
 *   fetch_opengraph(url)             -> STRUCT   fetch a page, then summarize it
 *
 * All are vectorized scalars, so they work over a whole column of HTML or URLs.
 */

import { defineScalarFunction, field, int32, list, struct, utf8, type VgiBatch } from "@query-farm/vgi";
import { fetchAll } from "./fetch.ts";
import { objectTags } from "./meta.ts";
import { type OpenGraph, parseOpenGraph, scanDocument } from "./parse.ts";

const doc = (comment: string) => new Map([["comment", comment]]);
const s = <N extends string>(name: N, comment: string) => field(name, utf8(), true, doc(comment));
const i = <N extends string>(name: N, comment: string) => field(name, int32, true, doc(comment));

const OG_FIELDS = [
  s("title", "Page title: og:title, else twitter:title, else the <title> element."),
  s("description", "Summary: og:description, else twitter:description, else <meta name=description>."),
  s("type", "og:type, e.g. 'website', 'article', 'video.movie'."),
  s("url", "Canonical page URL: og:url, else <link rel=canonical>."),
  s("site_name", "og:site_name: the name of the overall site."),
  s("locale", "og:locale, else the <html lang> attribute."),
  s("image", "Preview image URL: the first og:image, else twitter:image."),
  s("image_alt", "Alt text of the preview image (og:image:alt, else twitter:image:alt)."),
  i("image_width", "og:image:width of the first image, in pixels."),
  i("image_height", "og:image:height of the first image, in pixels."),
  field("images", list(field("item", utf8(), true)), true, doc("Every og:image URL, in document order.")),
  s("video", "og:video URL."),
  s("audio", "og:audio URL."),
  s("twitter_card", "twitter:card, e.g. 'summary' or 'summary_large_image'."),
  s("twitter_site", "twitter:site: the site's @handle."),
  s("twitter_creator", "twitter:creator: the author's @handle."),
  s("canonical_url", "href of <link rel=canonical>."),
  s("favicon_url", "href of <link rel=icon>, else apple-touch-icon."),
  s("oembed_url", "oEmbed JSON discovery URL (<link rel=alternate type=application/json+oembed>)."),
] as const;

export const OPENGRAPH_TYPE = struct(OG_FIELDS);

export const FETCHED_TYPE = struct([
  ...OG_FIELDS,
  s("final_url", "URL after redirects; relative page URLs are resolved against it."),
  i("http_status", "HTTP status of the final response; NULL when no response arrived."),
  s("content_type", "Content-Type header of the final response."),
  s("error", "Why the page could not be read (timeout, HTTP 404, not HTML, …); NULL on success."),
] as const);

export const TAGS_TYPE = list(
  field(
    "item",
    struct([
      s("property", "The property= or name= attribute, lower-cased (og:title, twitter:card, description, …)."),
      s("content", "The content= attribute, entity-decoded and whitespace-trimmed."),
    ] as const),
    true,
  ),
);

function column(batch: VgiBatch, index: number): (string | null)[] {
  return Array.from((batch.getChildAt(index) ?? []) as Iterable<string | null>);
}

const SUMMARY_FIELDS =
  "title, description, type, url, site_name, locale, image, image_alt, image_width, image_height, " +
  "images (list), video, audio, twitter_card, twitter_site, twitter_creator, canonical_url, " +
  "favicon_url, oembed_url";

const PRECEDENCE =
  "Fallbacks: title = og:title → twitter:title → <title>; description = og:description → " +
  "twitter:description → <meta name=description>; url = og:url → <link rel=canonical>; " +
  "image = first og:image → twitter:image; locale = og:locale → <html lang>. The first " +
  "occurrence of a property wins. Values are entity-decoded and whitespace-trimmed; absent " +
  "values are NULL (images is an empty list).";

const SAMPLE_HTML =
  '\'<html lang="en"><head><title>Fallback</title>' +
  '<meta property="og:title" content="Rock &amp; Roll">' +
  '<meta property="og:image" content="/cover.png"></head></html>\'';

const toRow = (og: OpenGraph) => og;

/** Deterministic, network-free examples that vgi-lint executes and compares. */
const executable = (examples: { description: string; sql: string; expected_result: unknown[][] }[]) => ({
  "vgi.executable_examples": JSON.stringify(examples),
});

export const parseOpengraph = defineScalarFunction({
  name: "parse_opengraph",
  description: "Parse Open Graph, Twitter Card and basic HTML metadata from an HTML document into a `STRUCT`.",
  params: { html: utf8() },
  argDocs: { html: "HTML document text (a full page or just its <head>); NULL in, NULL out." },
  returns: OPENGRAPH_TYPE,
  compute: (batch) => column(batch, 0).map((html) => (html == null ? null : toRow(parseOpenGraph(html)))),
  tags: {
    ...objectTags({
      title: "Parse Open Graph metadata",
      category: "parse",
      keywords:
        "open graph, opengraph, og:title, og:image, twitter card, meta tags, link preview, unfurl, html metadata, social preview",
      docLlm:
        "Parse an HTML document (`VARCHAR`) that you already have, e.g. from read_text() or a crawl " +
        "table, and return one `STRUCT` of its link-preview metadata with fields: " +
        `${SUMMARY_FIELDS}. ${PRECEDENCE} URL fields are returned as written; use the two-argument ` +
        "overload parse_opengraph(html, base_url) to make relative URLs absolute. Access a field " +
        "with dot syntax: `parse_opengraph(html).title`. Does no network access; to download a " +
        "page first, use fetch_opengraph(url). NULL html gives NULL.",
      docMd:
        "## parse_opengraph(html)\n\n" +
        "Summarize a page's Open Graph / Twitter Card metadata as a `STRUCT`: " +
        "`title`, `description`, `type`, `url`, `site_name`, `locale`, `image` (+ `image_alt`, " +
        "`image_width`, `image_height`), `images`, `video`, `audio`, `twitter_*`, `canonical_url`, " +
        "`favicon_url`, `oembed_url`.\n\n" +
        "Missing Open Graph tags fall back to Twitter Card tags, then to plain HTML " +
        "(`<title>`, `<meta name=description>`, `<link rel=canonical>`).",
    }),
    ...executable([
      {
        description: "Open Graph title wins over <title>; entities are decoded",
        sql: `SELECT og.title, og.locale, og.image FROM (SELECT opengraph.main.parse_opengraph(${SAMPLE_HTML}) AS og) ORDER BY ALL`,
        expected_result: [["Rock & Roll", "en", "/cover.png"]],
      },
    ]),
  },
  examples: [
    {
      sql: `SELECT og.title, og.image FROM (SELECT opengraph.main.parse_opengraph(${SAMPLE_HTML}) AS og)`,
      description: "Pull the title and preview image out of an HTML document",
    },
  ],
});

export const parseOpengraphWithBase = defineScalarFunction({
  name: "parse_opengraph",
  description: "Parse Open Graph metadata from HTML, resolving relative URLs against the page's URL.",
  params: { html: utf8(), base_url: utf8() },
  argDocs: {
    html: "HTML document text; NULL in, NULL out.",
    base_url:
      "URL the HTML was fetched from, e.g. 'https://example.com/post/1'. Relative image, url, " +
      "video, audio, canonical, favicon and oEmbed values are resolved against it (a <base href> " +
      "in the page takes precedence). NULL leaves URLs as written.",
  },
  returns: OPENGRAPH_TYPE,
  compute: (batch) => {
    const html = column(batch, 0);
    const base = column(batch, 1);
    return html.map((h, n) => (h == null ? null : toRow(parseOpenGraph(h, base[n] ?? null))));
  },
  tags: {
    ...objectTags({
      title: "Parse Open Graph metadata (absolute URLs)",
      category: "parse",
      keywords:
        "open graph, opengraph, base url, absolute url, relative url, og:image, link preview, crawl, html metadata",
      docLlm:
        "Same as parse_opengraph(html) but takes the page's own URL as a second argument and " +
        "returns every URL-valued field (url, image, images, video, audio, canonical_url, " +
        "favicon_url, oembed_url) as an absolute URL. Use it when you stored crawled HTML next " +
        "to its URL: `parse_opengraph(body, page_url)`. A <base href> in the document overrides " +
        `base_url. Fields: ${SUMMARY_FIELDS}. ${PRECEDENCE}`,
      docMd:
        "## parse_opengraph(html, base_url)\n\n" +
        "Like `parse_opengraph(html)`, with relative URLs resolved against `base_url` " +
        "(or the page's `<base href>`).",
    }),
    ...executable([
      {
        description: "A relative og:image becomes absolute",
        sql: `SELECT opengraph.main.parse_opengraph(${SAMPLE_HTML}, 'https://example.com/music/').image AS image ORDER BY ALL`,
        expected_result: [["https://example.com/cover.png"]],
      },
    ]),
  },
  examples: [
    {
      sql: `SELECT opengraph.main.parse_opengraph(${SAMPLE_HTML}, 'https://example.com/music/').image AS image`,
      description: "Resolve a relative og:image against the page URL",
    },
  ],
});

export const opengraphTags = defineScalarFunction({
  name: "opengraph_tags",
  description: "List every <meta> property/name and content pair in an HTML document, in document order.",
  params: { html: utf8() },
  argDocs: { html: "HTML document text; NULL in, NULL out." },
  returns: TAGS_TYPE,
  compute: (batch) => column(batch, 0).map((html) => (html == null ? null : scanDocument(html).tags)),
  tags: {
    ...objectTags({
      title: "List meta tags",
      category: "parse",
      keywords: "meta tags, open graph, og:, twitter:, article:published_time, property, content, unnest, raw metadata",
      docLlm:
        "Return a `LIST(STRUCT(property VARCHAR, content VARCHAR))` with every <meta> tag that has " +
        "a property= or name= attribute and a content= attribute, in document order, duplicates " +
        "kept. property is lower-cased (og:title, og:image:width, article:published_time, " +
        "twitter:card, description, …); content is entity-decoded. Use it for properties the " +
        "parse_opengraph summary doesn't carry (article:*, product:*, og:video:width, multiple " +
        "og:locale:alternate): unnest the list and filter on t.property. No network access.",
      docMd:
        "## opengraph_tags(html)\n\n" +
        "Every `<meta property|name=… content=…>` as a list of `{property, content}` structs. " +
        "`unnest` it to filter, pivot or count properties.",
    }),
    ...executable([
      {
        description: "Raw meta tags, one row each",
        sql:
          "SELECT t.property, t.content FROM (SELECT unnest(opengraph.main.opengraph_tags(" +
          '\'<meta property="og:type" content="article"><meta property="article:author" content="Ada">\'' +
          ")) AS t) ORDER BY t.property",
        expected_result: [
          ["article:author", "Ada"],
          ["og:type", "article"],
        ],
      },
    ]),
  },
  examples: [
    {
      sql:
        "SELECT t.property, t.content FROM (SELECT unnest(opengraph.main.opengraph_tags(" +
        '\'<meta property="og:type" content="article"><meta property="article:author" content="Ada">\'' +
        ")) AS t) ORDER BY t.property",
      description: "Unnest the raw meta tags of a document",
    },
  ],
});

export const fetchOpengraph = defineScalarFunction({
  name: "fetch_opengraph",
  description: "Download a web page and return its Open Graph metadata as a STRUCT, with HTTP status and error.",
  params: { url: utf8() },
  argDocs: {
    url: "http:// or https:// page URL to fetch; redirects are followed. NULL in, NULL out.",
  },
  returns: FETCHED_TYPE,
  compute: async (batch) => fetchAll(column(batch, 0)),
  tags: {
    ...objectTags({
      title: "Fetch Open Graph metadata",
      category: "fetch",
      keywords:
        "fetch url, link preview, unfurl, scrape, crawl, open graph, og:image, page title, http, website metadata",
      docLlm:
        "Fetch each URL over HTTP(S) (following redirects, reading only the document head) and " +
        "return the same `STRUCT` as parse_opengraph plus final_url (after redirects; relative URLs " +
        "are resolved against it), http_status `INTEGER`, content_type and error. A page that can't " +
        "be read does NOT fail the query: its row has error set (e.g. 'HTTP 404 Not Found', " +
        "'timed out after 10000 ms', 'not an HTML page …') and NULL metadata, so filter with " +
        "`WHERE og.error IS NULL`. URLs in one batch are fetched concurrently (8 at a time) and " +
        "duplicates are fetched once; 429/5xx responses are retried. Tune with the environment " +
        "variables OPENGRAPH_TIMEOUT_MS, OPENGRAPH_MAX_BYTES, OPENGRAPH_CONCURRENCY and " +
        "OPENGRAPH_USER_AGENT. Results depend on the live web; if you already have the HTML, use " +
        "parse_opengraph(html, base_url) instead.",
      docMd:
        "## fetch_opengraph(url)\n\n" +
        "Download pages and summarize their link-preview metadata. Adds `final_url`, " +
        "`http_status`, `content_type` and `error` to the `parse_opengraph` fields. Failures are " +
        "reported in `error` rather than failing the query.",
    }),
  },
  examples: [
    {
      sql:
        "SELECT og.title, og.site_name, og.image FROM (SELECT opengraph.main.fetch_opengraph(" +
        "'https://github.com/duckdb/duckdb') AS og) WHERE og.error IS NULL",
      description: "Unfurl a link the way a chat app would",
    },
  ],
});
