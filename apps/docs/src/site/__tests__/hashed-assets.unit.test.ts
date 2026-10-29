import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  builtFontPaths,
  contentHash,
  hashedName,
  isHashedFile,
  publishMedia,
  rewriteHtmlMedia,
  rewriteTextMedia,
} from "../hashed-assets.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-hashed-assets-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function authored({ file, contents }: { file: string; contents: string }) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), contents);
}

describe("content-hashed media names", () => {
  /** @scenario "Name every published media file by its content" */
  it("names a file by its content beside its authored path", () => {
    const name = hashedName({ name: "/images/a/shot.png", bytes: "pixels" });
    expect(name).toBe(`/images/a/shot.${contentHash({ bytes: "pixels" })}.png`);
    expect(name).toMatch(/^\/images\/a\/shot\.[0-9a-f]{12}\.png$/);
    expect(hashedName({ name: "/images/a/shot.png", bytes: "other" })).not.toBe(name);
  });

  /** @scenario "Name every published media file by its content" */
  it("tells a host which files it may cache forever", () => {
    expect(isHashedFile({ sitePath: "/assets/search-DYObYZMI.js" })).toBe(true);
    expect(isHashedFile({ sitePath: "/media/videos/tour.0123456789ab.webm" })).toBe(true);
    expect(isHashedFile({ sitePath: "/images/coding-agents/session-detail-1560.webp" })).toBe(
      false,
    );
    expect(isHashedFile({ sitePath: "/logo/light.svg" })).toBe(false);
    expect(isHashedFile({ sitePath: "/index.html" })).toBe(false);
  });

  /** @scenario "Name every published media file by its content" */
  it("renames every local media URL a page names, keeping the base path and descriptors", () => {
    const renames = new Map([
      ["/images/a.png", "/images/a.111111111111.png"],
      ["/media/b c.webp", "/media/b c.222222222222.webp"],
    ]);
    const html = [
      '<img src="/docs/images/a.png?v=1#x"/>',
      '<source srcSet="/docs/images/a.png 1x, /docs/media/b%20c.webp 2x"/>',
      '<link rel="preload" imagesrcset="/docs/images/a.png 640w" href="/docs/images/a.png">',
      '<img src="https://example.com/images/a.png"/><img src="/images/a.png"/>',
      '<a data-src="/docs/images/a.png" href="/docs/guide">Guide</a>',
    ].join("");
    expect(rewriteHtmlMedia({ html, basePath: "/docs", rename: (p) => renames.get(p) })).toBe(
      [
        '<img src="/docs/images/a.111111111111.png?v=1#x"/>',
        '<source srcSet="/docs/images/a.111111111111.png 1x, /docs/media/b%20c.222222222222.webp 2x"/>',
        '<link rel="preload" imagesrcset="/docs/images/a.111111111111.png 640w" href="/docs/images/a.111111111111.png">',
        '<img src="https://example.com/images/a.png"/><img src="/images/a.png"/>',
        '<a data-src="/docs/images/a.png" href="/docs/guide">Guide</a>',
      ].join(""),
    );
  });

  /** @scenario "Name every published media file by its content" */
  it("gives an agent export the public, hashed address of each renamed file", () => {
    const rename = (sitePath: string) =>
      sitePath === "/images/a.png" ? "/images/a-1680.333333333333.webp" : undefined;
    const text =
      '![Shot](https://langwatch.ai/docs/images/a.png) and <img src="/images/a.png"/>, not /images/b.png';
    expect(rewriteTextMedia({ text, rename })).toBe(
      '![Shot](https://langwatch.ai/docs/images/a-1680.333333333333.webp) and <img src="https://langwatch.ai/docs/images/a-1680.333333333333.webp"/>, not /images/b.png',
    );
  });

  /** @scenario "Name every published media file by its content" */
  it("maps each preloaded font to the hashed file the stylesheet loads", () => {
    expect(
      builtFontPaths({
        fonts: ["Inter-Variable-latin.woff2", "Inter-Variable-latin-ext.woff2", "Gone.woff2"],
        assets: ["Inter-Variable-latin-ext-Ab_9-xYz.woff2", "Inter-Variable-latin-C1d2E3f4.woff2"],
      }),
    ).toEqual(
      new Map([
        [
          "/src/app/fonts/Inter-Variable-latin.woff2",
          "/assets/Inter-Variable-latin-C1d2E3f4.woff2",
        ],
        [
          "/src/app/fonts/Inter-Variable-latin-ext.woff2",
          "/assets/Inter-Variable-latin-ext-Ab_9-xYz.woff2",
        ],
      ]),
    );
  });
});

describe("publishing the media a build references", () => {
  /** @scenario "Name every published media file by its content" */
  it("publishes referenced media hashed, stable files by name and nothing unreferenced", async () => {
    authored({ file: "images/shot.png", contents: "screenshot" });
    authored({ file: "images/diagram.svg", contents: "<svg/>" });
    authored({ file: "images/unused.png", contents: "never shown" });
    authored({ file: "images/logos/acme.svg", contents: "<svg>acme</svg>" });
    authored({ file: "logo/light.svg", contents: "<svg>logo</svg>" });
    authored({ file: "favicon.svg", contents: "<svg>icon</svg>" });
    authored({ file: "media/posters/clip.webp", contents: "poster" });
    const page =
      '<img src="/docs/images/shot.png"/><img src="/docs/images/diagram.svg"/><img src="/docs/images/logos/acme.svg"/><video poster="/docs/media/posters/clip.webp"></video>';
    const result = await publishMedia({
      pages: new Map([
        ["a/index.html", page],
        ["a.html", page],
      ]),
      texts: new Map([["a.md", "![Shot](https://langwatch.ai/docs/images/shot.png)"]]),
      docsRoot: root,
      basePath: "/docs",
      aliases: new Map([["/images/shot.png", "/images/shot-840.444444444444.webp"]]),
    });
    const svg = hashedName({ name: "images/diagram.svg", bytes: "<svg/>" });
    const poster = hashedName({ name: "media/posters/clip.webp", bytes: "poster" });
    expect([...result.copies.keys()].toSorted()).toEqual(
      [svg, poster, "favicon.svg", "images/logos/acme.svg", "logo/light.svg"].toSorted(),
    );
    expect(result.copies.get(svg)).toBe(path.join(root, "images/diagram.svg"));
    expect(result.pages.get("a.html")).toBe(
      `<img src="/docs/images/shot-840.444444444444.webp"/><img src="/docs/${svg}"/><img src="/docs/images/logos/acme.svg"/><video poster="/docs/${poster}"></video>`,
    );
    expect(result.texts.get("a.md")).toBe(
      "![Shot](https://langwatch.ai/docs/images/shot-840.444444444444.webp)",
    );
  });
});
