import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashedName } from "../hashed-assets.ts";
import { encodeImage, optimisePageImages, variantWidths } from "../image-variants.ts";

let root = "";

/* A gradient with fine grain compresses poorly as PNG, so its modern encodings come out smaller. */
async function capture({ width, height }: { width: number; height: number }) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    pixels[index] = (((index / 3) % width) % 200) + (seed % 24);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-image-variants-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("modern image encodings", () => {
  /** @scenario "Serve authored screenshots as modern images" */
  it("encodes AVIF and WebP at the column's 1x and 2x widths and reuses the cache", async () => {
    const input = await capture({ width: 2000, height: 40 });
    const cacheDir = path.join(root, "cache");
    const first = await encodeImage({ input, sitePath: "/images/a/shot.png", cacheDir });
    expect(first.map(({ type, width }) => `${type} ${width}`)).toEqual([
      "image/avif 840",
      "image/avif 1680",
      "image/webp 840",
      "image/webp 1680",
    ]);
    for (const encoded of first) {
      expect(encoded.bytes.length).toBeLessThan(input.length);
      expect((await sharp(encoded.bytes).metadata()).width).toBe(encoded.width);
      expect(encoded.name).toBe(
        hashedName({
          name: `images/a/shot-${encoded.width}.${encoded.type.slice(6)}`,
          bytes: encoded.bytes,
        }),
      );
    }
    expect(readdirSync(cacheDir)).toHaveLength(4);
    writeFileSync(path.join(cacheDir, readdirSync(cacheDir)[0] ?? ""), "corrupt");
    const second = await encodeImage({ input, sitePath: "/images/a/shot.png", cacheDir });
    expect(second.map((encoded) => encoded.name)).toEqual(first.map((encoded) => encoded.name));
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("publishes one width for an image near the column's width", () => {
    expect(variantWidths({ width: 3000 })).toEqual([840, 1680]);
    expect(variantWidths({ width: 1200 })).toEqual([840, 1200]);
    expect(variantWidths({ width: 1000 })).toEqual([1000]);
    expect(variantWidths({ width: 300 })).toEqual([300]);
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("strips metadata and drops cache entries a build no longer uses", async () => {
    const input = await sharp(await capture({ width: 300, height: 60 }))
      .withExif({ IFD0: { Copyright: "ACME" } })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const cacheDir = path.join(root, "cache");
    mkdirSync(cacheDir);
    writeFileSync(path.join(cacheDir, "stale.avif"), "old");
    mkdirSync(path.join(root, "images"));
    writeFileSync(path.join(root, "images/shot.jpg"), input);
    const html = `<html><head><title>T</title></head><body><article class="docs-prose"><img class="docs-img" src="/images/shot.jpg"/></article></body></html>`;
    const result = await optimisePageImages({
      pages: new Map([["guide/index.html", html]]),
      docsRoot: root,
      basePath: "",
      cacheDir,
    });
    for (const bytes of result.files.values())
      expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    expect(readdirSync(cacheDir)).not.toContain("stale.avif");
    expect(readdirSync(cacheDir)).toHaveLength(2);
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("publishes no encoding larger than the original", async () => {
    const flat = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const encoded = await encodeImage({
      input: flat,
      sitePath: "/images/flat.png",
      cacheDir: null,
    });
    expect(encoded.length).toBeLessThan(2);
    for (const { bytes } of encoded) expect(bytes.length).toBeLessThan(flat.length);
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("rewrites every page that shows an image and returns its encoded files", async () => {
    mkdirSync(path.join(root, "images"));
    writeFileSync(path.join(root, "images/shot.png"), await capture({ width: 300, height: 60 }));
    const html = `<html><head><title>T</title></head><body><article class="docs-prose"><img class="docs-img" src="/images/shot.png" alt="" loading="lazy" decoding="async" width="300" height="60"/><img class="docs-img" src="/images/missing.png"/></article></body></html>`;
    const result = await optimisePageImages({
      pages: new Map([
        ["guide/index.html", html],
        ["guide.html", html],
      ]),
      docsRoot: root,
      basePath: "",
      cacheDir: null,
    });
    const names = [...result.files.keys()];
    expect(names.map((name) => name.replace(/\.[0-9a-f]{12}\./, ".<hash>."))).toEqual([
      "images/shot-300.<hash>.avif",
      "images/shot-300.<hash>.webp",
    ]);
    expect(result.aliases).toEqual(new Map([["/images/shot.png", `/${names[1]}`]]));
    for (const page of result.pages.values()) {
      expect(page.match(/<picture/g)).toHaveLength(1);
      expect(page).toContain('rel="preload" as="image" type="image/avif"');
      expect(page).toContain(`<img class="docs-img" src="/${names[1]}"`);
    }
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("serves an authored WebP wider than the column at the column's widths", async () => {
    mkdirSync(path.join(root, "images"));
    const wide = await sharp(await capture({ width: 2400, height: 40 }))
      .webp({ quality: 100 })
      .toBuffer();
    writeFileSync(path.join(root, "images/wide.webp"), wide);
    const html = `<html><head><title>T</title></head><body><article class="docs-prose"><img class="docs-img" src="/images/wide.webp" alt=""/></article></body></html>`;
    const result = await optimisePageImages({
      pages: new Map([["guide/index.html", html]]),
      docsRoot: root,
      basePath: "",
      cacheDir: null,
    });
    const page = result.pages.get("guide/index.html") ?? "";
    expect(page).toMatch(/<source type="image\/webp" srcset="\/images\/wide-840\.\w+\.webp 840w/);
    expect(result.aliases.get("/images/wide.webp")).toMatch(/^\/images\/wide-1680\./);
  });
});
