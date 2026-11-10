import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

/* The Latin font files are subset by hand (README "Binary assets") to the range each face
   declares in docs.css. With `font-display: optional` a glyph the file lacks would silently
   render in the fallback, so this pins the files to the stylesheet. */

const css = readFileSync(new URL("../docs.css", import.meta.url), "utf8");

/* WOFF2 known-table tags, by the index a table directory entry's flags carry. */
const KNOWN_TAGS =
  "cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
    .match(/.{4}\s?/g)
    ?.map((tag) => tag.slice(0, 4).trimEnd()) ?? [];

/** The untransformed tables of a WOFF2 file, by tag. */
function woff2Tables({ file }: { file: Buffer }) {
  const count = file.readUInt16BE(12);
  let offset = 48;
  const readBase128 = () => {
    let value = 0;
    for (;;) {
      const byte = file[offset++] ?? 0;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
  };
  const entries: { tag: string; length: number; transformed: boolean }[] = [];
  for (let index = 0; index < count; index++) {
    const flags = file[offset++] ?? 0;
    let tag = KNOWN_TAGS[flags & 0x3f] ?? "";
    if ((flags & 0x3f) === 63) {
      tag = file.toString("latin1", offset, offset + 4);
      offset += 4;
    }
    const version = flags >> 6;
    const original = readBase128();
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    entries.push({ tag, length: transformed ? readBase128() : original, transformed });
  }
  const data = brotliDecompressSync(file.subarray(offset, offset + file.readUInt32BE(20)));
  const tables = new Map<string, Buffer>();
  let cursor = 0;
  for (const entry of entries) {
    if (!entry.transformed) tables.set(entry.tag, data.subarray(cursor, cursor + entry.length));
    cursor += entry.length;
  }
  return tables;
}

/** Code points a `cmap` table maps (formats 4 and 12). */
function mappedCodePoints({ cmap }: { cmap: Buffer }) {
  const points = new Set<number>();
  for (let index = 0; index < cmap.readUInt16BE(2); index++) {
    const subtable = cmap.readUInt32BE(4 + index * 8 + 4);
    const format = cmap.readUInt16BE(subtable);
    if (format === 4) {
      const segments = cmap.readUInt16BE(subtable + 6) / 2;
      const ends = subtable + 14;
      const starts = ends + segments * 2 + 2;
      for (let segment = 0; segment < segments; segment++) {
        const end = cmap.readUInt16BE(ends + segment * 2);
        for (let point = cmap.readUInt16BE(starts + segment * 2); point <= end; point++)
          if (point !== 0xffff) points.add(point);
      }
    } else if (format === 12) {
      for (let group = 0; group < cmap.readUInt32BE(subtable + 12); group++) {
        const at = subtable + 16 + group * 12;
        for (let point = cmap.readUInt32BE(at); point <= cmap.readUInt32BE(at + 4); point++)
          points.add(point);
      }
    }
  }
  return points;
}

/** The `wght` axis of an `fvar` table, as [min, max]. */
function weightAxis({ fvar }: { fvar: Buffer }) {
  /* Header: version (4), axes array offset (2), reserved (2), axis count (2), axis size (2). */
  for (let index = 0; index < fvar.readUInt16BE(8); index++) {
    const at = fvar.readUInt16BE(4) + index * fvar.readUInt16BE(10);
    if (fvar.toString("latin1", at, at + 4) === "wght")
      return [fvar.readInt32BE(at + 4) / 65536, fvar.readInt32BE(at + 12) / 65536];
  }
  return null;
}

/** The `@font-face` block whose `src` names `file`. */
function face({ file }: { file: string }) {
  const block = css.split("@font-face").find((candidate) => candidate.includes(`/${file}"`));
  if (!block) throw new Error(`no @font-face names ${file}`);
  return block.slice(0, block.indexOf("}"));
}

/* Text every page draws: ASCII, Latin-1 and the typographic punctuation of English prose. */
const COMMON_TEXT = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, index) => 0x20 + index),
  /* Latin-1, without the soft hyphen (U+00AD): it never draws, and Inter has no glyph for it. */
  ...Array.from({ length: 0xff - 0xa1 + 1 }, (_, index) => 0xa1 + index).filter(
    (point) => point !== 0xad,
  ),
  0x2013,
  0x2014,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2026,
];

const FILES = [
  "Inter-Variable-latin.woff2",
  "Sentient-Regular.woff2",
  "Sentient-Medium.woff2",
  "JetBrainsMono-Variable-latin.woff2",
];

describe("the subset Latin web fonts", () => {
  for (const file of FILES) {
    describe(`when ${file} is read`, () => {
      const tables = woff2Tables({
        file: readFileSync(new URL(`../fonts/${file}`, import.meta.url)),
      });
      const declared = face({ file });

      /** @scenario "Ship web fonts cut to the characters and weights the docs draw" */
      it("covers the common text characters", () => {
        const cmap = tables.get("cmap");
        if (!cmap) throw new Error(`${file} has no cmap`);
        const mapped = mappedCodePoints({ cmap });
        expect(
          COMMON_TEXT.filter((point) => !mapped.has(point)).map((point) => point.toString(16)),
        ).toEqual([]);
      });

      /** @scenario "Ship web fonts cut to the characters and weights the docs draw" */
      it("spans exactly the weights its face declares", () => {
        const fvar = tables.get("fvar");
        const weight = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(declared);
        const [min, max = min] = [weight?.[1], weight?.[2]].filter(Boolean).map(Number);
        expect(fvar ? weightAxis({ fvar }) : [min, min]).toEqual([min, max]);
      });
    });
  }
});
