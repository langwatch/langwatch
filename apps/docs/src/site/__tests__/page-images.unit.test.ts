import { describe, expect, it } from "vitest";

import { pageRasters, rewritePageImages, type ImageVariants } from "../page-images.ts";

const head = "<html><head><title>Guide</title></head><body><header><h1>Guide</h1></header>";
const page = ({ article }: { article: string }) =>
  `${head}<article data-type-mode="expressive" class="docs-prose css-1">${article}</article><footer><img class="docs-img" src="/docs/images/footer.png"/></footer></body></html>`;
const img = ({ src, extra = "" }: { src: string; extra?: string }) =>
  `<img class="docs-img${extra}" src="${src}" alt="" loading="lazy" decoding="async" width="1440" height="900"/>`;
const variantsOf = ({ name }: { name: string }) => [
  { type: "image/avif", path: `/docs/media/optimized/${name}-1440.avif`, width: 1440 },
  { type: "image/webp", path: `/docs/media/optimized/${name}-1440.webp`, width: 1440 },
];
const variants: ImageVariants = new Map([
  ["/images/first.png", variantsOf({ name: "first" })],
  ["/images/second.jpg", variantsOf({ name: "second" })],
  ["/images/light.png", variantsOf({ name: "light" })],
  ["/images/dark.png", variantsOf({ name: "dark" })],
]);
const rewrite = ({ article }: { article: string }) =>
  rewritePageImages({ html: page({ article }), variants, basePath: "/docs" });
const preloads = ({ html }: { html: string }) => html.match(/<link rel="preload"[^>]*>/g) ?? [];

describe("authored raster images", () => {
  /** @scenario "Serve authored screenshots as modern images" */
  it("offers AVIF and WebP, names the WebP in the img and keeps the intrinsic size", () => {
    const html = rewrite({
      article: `<p>Intro</p>${img({ src: "/docs/images/first.png" })}<h2>Next</h2><p>${"x".repeat(900)}</p>${img({ src: "/docs/images/second.jpg" })}`,
    });
    expect(html).toContain(
      '<picture style="display:contents"><source type="image/avif" srcset="/docs/media/optimized/first-1440.avif 1440w" sizes="(min-width: 64rem) 840px, 100vw"/><source type="image/webp" srcset="/docs/media/optimized/first-1440.webp 1440w" sizes="(min-width: 64rem) 840px, 100vw"/><img class="docs-img" src="/docs/media/optimized/first-1440.webp"',
    );
    expect(html.match(/<picture/g)).toHaveLength(2);
    expect(html.match(/width="1440" height="900"/g)).toHaveLength(2);
  });

  /** @scenario "Serve authored screenshots as modern images" */
  it("leaves vectors, GIFs, external, responsive and footer images as authored", () => {
    const article = [
      img({ src: "/docs/images/diagram.svg" }),
      img({ src: "/docs/images/clip.gif" }),
      img({ src: "https://example.com/badge.png" }),
      '<img class="docs-img" src="/docs/images/first.png" srcSet="/docs/images/first.png 1x"/>',
      `<picture>${img({ src: "/docs/images/second.jpg" })}</picture>`,
    ].join("");
    const html = rewrite({ article });
    expect(html.match(/<picture/g)).toHaveLength(1);
    expect(html).toContain('<footer><img class="docs-img" src="/docs/images/footer.png"/>');
    expect(pageRasters({ html: page({ article }), basePath: "/docs" })).toEqual([]);
  });
});

describe("the first image a reader sees", () => {
  /** @scenario "Preload the first image a reader sees" */
  it("loads eagerly at high priority, preloads its AVIF and lazy-loads the rest", () => {
    const html = rewrite({
      article: `<p>Intro</p>${img({ src: "/docs/images/first.png" })}${img({ src: "/docs/images/second.jpg" })}`,
    });
    expect(preloads({ html })).toEqual([
      '<link rel="preload" as="image" type="image/avif" href="/docs/media/optimized/first-1440.avif" imagesrcset="/docs/media/optimized/first-1440.avif 1440w" imagesizes="(min-width: 64rem) 840px, 100vw" fetchpriority="high">',
    ]);
    expect(html.indexOf('<title>Guide</title><link rel="preload"')).toBeGreaterThan(0);
    expect(html).toMatch(
      /first-1440\.webp" alt="" loading="eager" decoding="async"[^>]*fetchpriority="high"\/>/,
    );
    expect(html).toMatch(
      /second-1440\.webp" alt="" loading="lazy" decoding="async" width="1440" height="900"\/>/,
    );
  });

  /** @scenario "Preload the first image a reader sees" */
  it("preloads each variant of a light and dark pair for its colour scheme and keeps both lazy", () => {
    const html = rewrite({
      article: `<span class="docs-shot docs-light-only" data-shot="shot">${img({ src: "/docs/images/light.png" })}</span><span class="docs-shot docs-dark-only" data-shot="shot">${img({ src: "/docs/images/dark.png" })}</span>`,
    });
    const links = preloads({ html });
    expect(links).toHaveLength(2);
    expect(links[0]).toContain("light-1440.avif 1440w");
    expect(links[0]).toContain('media="(prefers-color-scheme: light)"');
    expect(links[1]).toContain('media="(prefers-color-scheme: dark)"');
    expect(html).not.toContain('loading="eager"');
    expect(html.match(/fetchpriority="high"\/>/g)).toHaveLength(2);
  });

  /** @scenario "Preload the first image a reader sees" */
  it("never preloads an image below the fold, in a closed disclosure or in a hidden tab", () => {
    const articles = [
      `<p>${"word ".repeat(200)}</p>${img({ src: "/docs/images/first.png" })}`,
      `<h2>One</h2><p>a</p><h2>Two</h2>${img({ src: "/docs/images/first.png" })}`,
      `<details><summary>More</summary>${img({ src: "/docs/images/first.png" })}</details>`,
      `<div role="tabpanel" hidden="">${img({ src: "/docs/images/first.png" })}</div>`,
    ];
    for (const article of articles) {
      const html = rewrite({ article });
      expect(preloads({ html })).toEqual([]);
      expect(html).not.toContain('loading="eager"');
      expect(html).toContain("<picture");
    }
  });
});
