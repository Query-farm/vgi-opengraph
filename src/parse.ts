/**
 * Extract Open Graph, Twitter Card and basic HTML metadata from an HTML document.
 *
 * Parsing uses Bun's built-in HTMLRewriter (lol-html), a streaming,
 * spec-tolerant tokenizer, so malformed markup, missing `<head>` tags and
 * unquoted attributes are all handled without a DOM or extra dependency.
 *
 * Precedence for the summary fields:
 *   title        og:title → twitter:title → <title>
 *   description  og:description → twitter:description → <meta name="description">
 *   url          og:url → <link rel="canonical">
 *   image        first og:image (og:image:url / og:image:secure_url) → twitter:image
 *   locale       og:locale → <html lang>
 * The first occurrence of a property wins. With a base URL (or a `<base href>`),
 * every URL-valued field is resolved to an absolute URL.
 */

import { decodeEntities } from "./entities.ts";

/** One `<meta>` tag with a property/name and content, in document order. */
export interface MetaTag {
  property: string;
  content: string;
}

export interface OgImage {
  url: string | null;
  secure_url: string | null;
  type: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
}

/** The summary record returned by `parse_opengraph`. */
export interface OpenGraph {
  title: string | null;
  description: string | null;
  type: string | null;
  url: string | null;
  site_name: string | null;
  locale: string | null;
  image: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  images: string[];
  video: string | null;
  audio: string | null;
  twitter_card: string | null;
  twitter_site: string | null;
  twitter_creator: string | null;
  canonical_url: string | null;
  favicon_url: string | null;
  oembed_url: string | null;
}

/** Everything one pass over the document collects. */
export interface ParsedDocument {
  tags: MetaTag[];
  title: string | null;
  lang: string | null;
  baseHref: string | null;
  canonical: string | null;
  icon: string | null;
  touchIcon: string | null;
  oembed: string | null;
  charset: string | null;
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = decodeEntities(value).replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
}

function relTokens(rel: string | null): string[] {
  return (rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Tokenize `html` once, collecting meta tags, the title and the useful `<link>`s. */
export function scanDocument(html: string): ParsedDocument {
  const doc: ParsedDocument = {
    tags: [],
    title: null,
    lang: null,
    baseHref: null,
    canonical: null,
    icon: null,
    touchIcon: null,
    oembed: null,
    charset: null,
  };
  // `<title>` also appears inside inline SVG; only the first document title counts.
  let svgDepth = 0;
  let titleState: "none" | "reading" | "done" = "none";
  let titleText = "";

  new HTMLRewriter()
    .on("html", {
      element(e) {
        doc.lang ??= clean(e.getAttribute("lang") ?? e.getAttribute("xml:lang"));
      },
    })
    .on("svg", {
      element(e) {
        svgDepth++;
        if (e.selfClosing || !e.canHaveContent) {
          svgDepth--;
          return;
        }
        e.onEndTag(() => {
          svgDepth--;
        });
      },
    })
    .on("title", {
      element(e) {
        if (svgDepth > 0 || titleState !== "none") return;
        titleState = "reading";
        e.onEndTag(() => {
          titleState = "done";
        });
      },
      text(t) {
        if (titleState === "reading" && svgDepth === 0) titleText += t.text;
      },
    })
    .on("base", {
      element(e) {
        doc.baseHref ??= clean(e.getAttribute("href"));
      },
    })
    .on("meta", {
      element(e) {
        const charset = e.getAttribute("charset");
        if (charset && !doc.charset) doc.charset = charset.trim().toLowerCase();
        const key = clean(e.getAttribute("property") ?? e.getAttribute("name"));
        const content = clean(e.getAttribute("content"));
        if (key && content != null) doc.tags.push({ property: key.toLowerCase(), content });
      },
    })
    .on("link", {
      element(e) {
        const href = clean(e.getAttribute("href"));
        if (!href) return;
        const rel = relTokens(e.getAttribute("rel"));
        if (rel.includes("canonical")) doc.canonical ??= href;
        if (rel.includes("icon")) doc.icon ??= href;
        if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) doc.touchIcon ??= href;
        const type = (e.getAttribute("type") ?? "").toLowerCase();
        if (rel.includes("alternate") && type.includes("json+oembed")) doc.oembed ??= href;
      },
    })
    .transform(html);

  doc.title = clean(titleText);
  return doc;
}

function resolve(value: string | null, base: URL | null): string | null {
  if (value == null || base == null) return value;
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function toInt(value: string | null | undefined): number | null {
  if (value == null) return null;
  const m = /^\s*(\d{1,9})/.exec(value);
  return m ? Number(m[1]) : null;
}

/** Group the `og:image*` structured properties into images, in document order. */
export function collectImages(tags: MetaTag[]): OgImage[] {
  const images: OgImage[] = [];
  const blank = (): OgImage => ({ url: null, secure_url: null, type: null, width: null, height: null, alt: null });
  const current = (): OgImage => {
    let img = images[images.length - 1];
    if (!img) {
      img = blank();
      images.push(img);
    }
    return img;
  };
  for (const { property, content } of tags) {
    if (!property.startsWith("og:image")) continue;
    switch (property) {
      case "og:image":
        images.push({ ...blank(), url: content });
        break;
      case "og:image:url": {
        // og:image:url is a synonym for og:image: it names the current image
        // unless that one already has a different URL.
        const img = images[images.length - 1];
        if (img && (img.url == null || img.url === content)) img.url = content;
        else images.push({ ...blank(), url: content });
        break;
      }
      case "og:image:secure_url":
        current().secure_url ??= content;
        break;
      case "og:image:type":
        current().type ??= content;
        break;
      case "og:image:width":
        current().width ??= toInt(content);
        break;
      case "og:image:height":
        current().height ??= toInt(content);
        break;
      case "og:image:alt":
        current().alt ??= content;
        break;
    }
  }
  return images.filter((i) => i.url != null || i.secure_url != null);
}

/** Build the summary record from a scanned document. `baseUrl` may be null. */
export function summarize(doc: ParsedDocument, baseUrl: string | null): OpenGraph {
  const first = new Map<string, string>();
  for (const { property, content } of doc.tags) if (!first.has(property)) first.set(property, content);
  const get = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = first.get(k);
      if (v != null) return v;
    }
    return null;
  };

  let base: URL | null = null;
  try {
    if (baseUrl) base = new URL(baseUrl);
  } catch {
    base = null;
  }
  if (doc.baseHref) {
    try {
      base = new URL(doc.baseHref, base ?? undefined);
    } catch {
      // A relative <base href> without a document URL can't be resolved; keep what we have.
    }
  }
  const abs = (v: string | null) => resolve(v, base);

  const images = collectImages(doc.tags);
  const lead = images[0];
  const image = lead ? (lead.url ?? lead.secure_url) : get("twitter:image", "twitter:image:src");
  const canonical = abs(doc.canonical);

  return {
    title: get("og:title", "twitter:title") ?? doc.title,
    description: get("og:description", "twitter:description", "description"),
    type: get("og:type"),
    url: abs(get("og:url")) ?? canonical,
    site_name: get("og:site_name"),
    locale: get("og:locale") ?? doc.lang,
    image: abs(image),
    image_alt: lead ? lead.alt : get("twitter:image:alt"),
    image_width: lead?.width ?? null,
    image_height: lead?.height ?? null,
    images: images.map((i) => abs(i.url ?? i.secure_url) as string),
    video: abs(get("og:video", "og:video:url", "og:video:secure_url")),
    audio: abs(get("og:audio", "og:audio:url", "og:audio:secure_url")),
    twitter_card: get("twitter:card"),
    twitter_site: get("twitter:site"),
    twitter_creator: get("twitter:creator"),
    canonical_url: canonical,
    favicon_url: abs(doc.icon ?? doc.touchIcon),
    oembed_url: abs(doc.oembed),
  };
}

/** Parse an HTML document into the Open Graph summary record. */
export function parseOpenGraph(html: string, baseUrl: string | null = null): OpenGraph {
  return summarize(scanDocument(html), baseUrl);
}
