import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeImage, optimisePageImages } from "../image-variants.ts";

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
  it("encodes AVIF and WebP no wider than twice the column and reuses the cache", async () => {
    const input = await capture({ width: 2000, height: 40 });
    const cacheDir = path.join(root, "cache");
    const first = await encodeImage({ input, cacheDir });
    expect(first.map((encoded) => encoded.type)).toEqual(["image/avif", "image/webp"]);
    for (const encoded of first) {
      expect(encoded.width).toBe(1680);
      expect(encoded.bytes.length).toBeLessThan(input.length);
      expect((await sharp(encoded.bytes).metadata()).width).toBe(1680);
    }
    expect(readdirSync(cacheDir)).toHaveLength(2);
    writeFileSync(path.join(cacheDir, readdirSync(cacheDir)[0] ?? ""), "corrupt");
    const second = await encodeImage({ input, cacheDir });
    expect(second.map((encoded) => encoded.name)).toEqual(first.map((encoded) => encoded.name));
    expect((await sharp(second[0]?.bytes).metadata()).width).toBe(1680);
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("publishes no encoding larger than the original", async () => {
    const flat = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const encoded = await encodeImage({ input: flat, cacheDir: null });
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
    expect(
      [...result.files.keys()].map((name) => name.replace(/[0-9a-f]{20}/, "<digest>")),
    ).toEqual(["media/optimized/<digest>-300.avif", "media/optimized/<digest>-300.webp"]);
    for (const page of result.pages.values()) {
      expect(page.match(/<picture/g)).toHaveLength(1);
      expect(page).toContain('rel="preload" as="image" type="image/avif"');
    }
  });
});
