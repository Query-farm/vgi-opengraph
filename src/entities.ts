/**
 * HTML character-reference decoding for attribute values and `<title>` text.
 *
 * Bun's HTMLRewriter (lol-html) hands back attribute values and text exactly
 * as written, so `Tom &amp; Jerry` must be decoded here. Numeric references are
 * decoded in full; named references cover the set that turns up in real page
 * metadata (punctuation, quotes, currency, Latin-1 letters).
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  para: "¶",
  sect: "§",
  dagger: "†",
  Dagger: "‡",
  prime: "′",
  Prime: "″",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  curren: "¤",
  iexcl: "¡",
  iquest: "¿",
  ordf: "ª",
  ordm: "º",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  frac14: "¼",
  frac12: "½",
  frac34: "¾",
  micro: "µ",
  shy: "­",
  zwj: "‍",
  zwnj: "‌",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  hearts: "♥",
  szlig: "ß",
  AElig: "Æ",
  aelig: "æ",
  OElig: "Œ",
  oelig: "œ",
  Oslash: "Ø",
  oslash: "ø",
  Aring: "Å",
  aring: "å",
  Ccedil: "Ç",
  ccedil: "ç",
  Ntilde: "Ñ",
  ntilde: "ñ",
  ETH: "Ð",
  eth: "ð",
  THORN: "Þ",
  thorn: "þ",
};

// Letters that take the common diacritic entities: &eacute; &Uuml; &ocirc; …
const ACCENTS: Record<string, Record<string, string>> = {
  grave: { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  acute: { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", Y: "Ý" },
  circ: { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  tilde: { a: "ã", o: "õ", A: "Ã", O: "Õ" },
  uml: { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" },
};

// Windows-1252 code points that HTML maps numeric references 0x80–0x9F onto.
const C1: Record<number, number> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178,
};

function named(name: string): string | undefined {
  const direct = NAMED[name];
  if (direct !== undefined) return direct;
  const m = /^([A-Za-z])(grave|acute|circ|tilde|uml)$/.exec(name);
  return m ? ACCENTS[m[2] as string]?.[m[1] as string] : undefined;
}

function codePoint(n: number): string {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "�";
  return String.fromCodePoint(C1[n] ?? n);
}

const REF = /&(?:#[xX]([0-9a-fA-F]{1,6});?|#([0-9]{1,7});?|([A-Za-z][A-Za-z0-9]{1,31});)/g;

/** Decode HTML character references; unknown named references are left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REF, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined) return codePoint(Number.parseInt(hex, 16));
    if (dec !== undefined) return codePoint(Number.parseInt(dec, 10));
    return named(name as string) ?? whole;
  });
}
