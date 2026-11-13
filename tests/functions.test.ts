// Unit tests. The SQL-level tests live in test/sql and run through DuckDB.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batchFromColumns, field, schema, utf8, VgiClient } from "@query-farm/vgi";
import { subprocessConnect } from "@query-farm/vgi-rpc";
import { decodeEntities } from "../src/entities.ts";
import { CONFIG, decodeBody, fetchAll, fetchOpenGraph } from "../src/fetch.ts";
import { collectImages, parseOpenGraph, scanDocument } from "../src/parse.ts";

const ROOT = join(import.meta.dir, "..");
const fixture = (name: string) => readFileSync(join(ROOT, "test", "fixtures", name), "utf8");

describe("decodeEntities", () => {
  test("named, decimal, hex and C1 references", () => {
    expect(decodeEntities("Tom &amp; Jerry &quot;x&quot; &#8212; &#x2603; &eacute; &#150;")).toBe(
      'Tom & Jerry "x" — ☃ é –',
    );
  });
  test("unknown or unterminated references are kept", () => {
    expect(decodeEntities("AT&T &bogus; &amp")).toBe("AT&T &bogus; &amp");
  });
});

describe("parseOpenGraph", () => {
  test("a full Open Graph page", () => {
    const og = parseOpenGraph(fixture("article.html"), "https://pond.example.test/guides/ducks?ref=1");
    expect(og).toEqual({
      title: "Ducks & Data: A Field Guide",
      description: "Everything about ducks, in one place.",
      type: "article",
      url: "https://pond.example.test/guides/ducks",
      site_name: "The Pond",
      locale: "en_GB",
      image: "https://pond.example.test/img/hero.jpg",
      image_alt: "A mallard — up close",
      image_width: 1200,
      image_height: 630,
      images: ["https://pond.example.test/img/hero.jpg", "https://cdn.example.test/img/second.png"],
      video: "https://pond.example.test/media/clip.mp4",
      audio: null,
      twitter_card: "summary_large_image",
      twitter_site: "@thepond",
      twitter_creator: "@ada",
      canonical_url: "https://pond.example.test/guides/ducks",
      favicon_url: "https://pond.example.test/favicon.ico",
      oembed_url: "https://pond.example.test/oembed?url=%2Fguides%2Fducks",
    });
  });

  test("without a base URL, URLs stay as written", () => {
    const og = parseOpenGraph(fixture("article.html"));
    expect(og.image).toBe("/img/hero.jpg");
    expect(og.url).toBe("/guides/ducks");
  });

  test("Twitter Card fallbacks", () => {
    const og = parseOpenGraph(fixture("twitter-only.html"), "https://t.example.test/a/b");
    expect(og.title).toBe("Twitter Title");
    expect(og.description).toBe("Twitter description");
    expect(og.image).toBe("https://t.example.test/a/images/card.png");
    expect(og.image_alt).toBe("Card art");
    expect(og.images).toEqual([]);
    expect(og.favicon_url).toBe("https://t.example.test/touch.png");
    expect(og.twitter_card).toBe("summary");
  });

  test("plain HTML fallbacks, <base href>, and SVG titles skipped", () => {
    const og = parseOpenGraph(fixture("plain.html"));
    expect(og.title).toBe('Only a "title"');
    expect(og.description).toBe("Just the basics.");
    expect(og.favicon_url).toBe("https://static.example.test/assets/icon.png");
    expect(og.locale).toBeNull();
    expect(og.type).toBeNull();
  });

  test("empty and non-HTML input give an all-NULL record", () => {
    for (const html of ["", "just some text", "<<<>>>"]) {
      const og = parseOpenGraph(html);
      expect(og.title).toBeNull();
      expect(og.images).toEqual([]);
    }
  });

  test("an invalid base URL is ignored", () => {
    expect(parseOpenGraph('<meta property="og:image" content="/x.png">', "not a url").image).toBe("/x.png");
  });
});

describe("collectImages", () => {
  test("structured properties attach to the preceding image", () => {
    const tags = scanDocument(
      '<meta property="og:image" content="a.png"><meta property="og:image:url" content="a.png">' +
        '<meta property="og:image:width" content="10"><meta property="og:image:url" content="b.png">' +
        '<meta property="og:image:height" content="20">',
    ).tags;
    expect(collectImages(tags).map((i) => [i.url, i.width, i.height])).toEqual([
      ["a.png", 10, null],
      ["b.png", null, 20],
    ]);
  });
  test("secure_url alone is an image", () => {
    const tags = scanDocument('<meta property="og:image:secure_url" content="https://x/y.png">').tags;
    expect(parseOpenGraph('<meta property="og:image:secure_url" content="https://x/y.png">').image).toBe(
      "https://x/y.png",
    );
    expect(collectImages(tags).length).toBe(1);
  });
});

test("scanDocument: meta tags in order, lower-cased keys, duplicates kept", () => {
  const tags = scanDocument(fixture("article.html")).tags;
  expect(tags.filter((t) => t.property === "article:tag").map((t) => t.content)).toEqual(["ducks", "sql"]);
  expect(tags.find((t) => t.property === "twitter:card")?.content).toBe("summary_large_image");
  expect(scanDocument('<META NAME="Description" CONTENT="x">').tags).toEqual([
    { property: "description", content: "x" },
  ]);
});

test("decodeBody: header charset, then <meta charset>, then UTF-8", () => {
  const cp1252 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]);
  expect(decodeBody(cp1252, "text/html; charset=windows-1252")).toBe("Café");
  const withMeta = new TextEncoder().encode('<meta charset="iso-8859-1">');
  expect(decodeBody(new Uint8Array([...withMeta, 0xe9]), null).endsWith("é")).toBe(true);
  expect(decodeBody(new TextEncoder().encode("é"), "text/html")).toBe("é");
  expect(decodeBody(new TextEncoder().encode("é"), "text/html; charset=no-such-charset")).toBe("é");
});

async function startFixtureSite(): Promise<{ url: string; proc: ReturnType<typeof Bun.spawn> }> {
  const proc = Bun.spawn([process.env.PYTHON ?? "python3", join(ROOT, "test", "fixture_site", "server.py")], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const port = text.match(/^PORT:(\d+)/)?.[1];
  if (!port) throw new Error(`fixture site did not report a port: ${text}`);
  return { url: `http://127.0.0.1:${port}`, proc };
}

describe("fetching from the fixture site", () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  beforeAll(async () => {
    site = await startFixtureSite();
  });
  afterAll(() => site?.proc.kill());

  test("a page: metadata plus status, resolved against the final URL", async () => {
    const og = await fetchOpenGraph(`${site.url}/article.html`);
    expect(og.error).toBeNull();
    expect(og.http_status).toBe(200);
    expect(og.content_type).toBe("text/html; charset=utf-8");
    expect(og.title).toBe("Ducks & Data: A Field Guide");
    expect(og.image).toBe(`${site.url}/img/hero.jpg`);
  });

  test("redirects are followed", async () => {
    const og = await fetchOpenGraph(`${site.url}/redirect`);
    expect(og.final_url).toBe(`${site.url}/article.html`);
    expect(og.site_name).toBe("The Pond");
  });

  test("charset from <meta charset>", async () => {
    expect((await fetchOpenGraph(`${site.url}/latin1`)).title).toBe("Café “Ole”");
  });

  test("429 is retried", async () => {
    expect((await fetchOpenGraph(`${site.url}/flaky`)).title).toBe("Second time lucky");
  });

  test("reading stops at </head> on a huge page", async () => {
    const started = performance.now();
    const og = await fetchOpenGraph(`${site.url}/big`);
    expect(og.title).toBe("Big page");
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("failures are values, not exceptions", async () => {
    const missing = await fetchOpenGraph(`${site.url}/missing`);
    expect([missing.http_status, missing.error, missing.title]).toEqual([404, "HTTP 404 Not Found", null]);
    expect((await fetchOpenGraph(`${site.url}/image.png`)).error).toBe("not an HTML page (content type image/png)");
    expect((await fetchOpenGraph("ftp://example.test/")).error).toMatch(/unsupported URL scheme 'ftp'/);
    expect((await fetchOpenGraph("not a url")).error).toMatch(/invalid URL/);
    const slow = await fetchOpenGraph(`${site.url}/slow`, { ...CONFIG, timeoutMs: 200 });
    expect(slow.error).toBe("timed out after 200 ms");
    expect(slow.http_status).toBeNull();
  });

  test("fetchAll keeps row order, NULLs and duplicates", async () => {
    const a = `${site.url}/article.html`;
    const b = `${site.url}/plain.html`;
    const out = await fetchAll([a, null, b, a]);
    expect(out.map((o) => o?.title ?? null)).toEqual([
      "Ducks & Data: A Field Guide",
      null,
      'Only a "title"',
      "Ducks & Data: A Field Guide",
    ]);
  });
});

describe("through the worker subprocess", () => {
  let client: VgiClient;
  beforeAll(() => {
    // A client that launches the worker as a subprocess, the way DuckDB does.
    client = new VgiClient(subprocessConnect([process.execPath, "run", join(ROOT, "src", "worker.ts")]));
  });
  afterAll(() => client?.close());

  async function scalar(name: string, columns: Record<string, (string | null)[]>) {
    const s = schema(Object.keys(columns).map((k) => field(k, utf8(), true)));
    const rows: Record<string, unknown>[] = [];
    for await (const page of client.scalarFunctionRows({
      functionName: name,
      input: [batchFromColumns(columns, s)],
    })) {
      rows.push(...page);
    }
    return rows.map((r) => Object.values(r)[0]);
  }

  test("parse_opengraph over a column with a NULL", async () => {
    const out = (await scalar("parse_opengraph", { html: [fixture("article.html"), null] })) as (Record<
      string,
      unknown
    > | null)[];
    expect(out[0]?.title).toBe("Ducks & Data: A Field Guide");
    expect(out[0]?.image_width).toBe(1200);
    expect(out[1]).toBeNull();
  });

  test("opengraph_tags returns property/content structs", async () => {
    const out = (await scalar("opengraph_tags", {
      html: ['<meta property="og:type" content="website">'],
    })) as unknown[];
    expect(JSON.parse(JSON.stringify(out[0]))).toEqual([{ property: "og:type", content: "website" }]);
  });
});
