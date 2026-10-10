/**
 * The loading screen as plain HTML: in every index.html's root, and over Vite's bundling page.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import { BOOT_SPLASH_BODY, bootSplash, brandFallbackPage } from "../boot-splash";

const VITE_FALLBACK = `<!DOCTYPE html>
<html lang="en">
<head>
  <script>globalThis.__vite_is_fallback_page__ = true</script>
  <script type="module">/* hmr client */</script>
  <style>:root { --page-bg: #ffffff; }</style>
</head>
<body>
  <div class="container"><h1>Bundling in progress</h1></div>
</body>
</html>`;

function transform(html: string): string {
  const hook = bootSplash().transformIndexHtml;
  if (!hook || typeof hook === "function") throw new Error("expected an ordered hook");
  return hook.handler.call({} as never, html, {} as never) as string;
}

describe("the boot splash", () => {
  describe("given the app's index.html", () => {
    it("lays the loading screen over the page, outside the root React draws into", () => {
      const html = transform('<html><head></head><body><div id="root"></div></body></html>');
      expect(html).toContain('<div id="root"></div>');
      expect(html.indexOf(BOOT_SPLASH_BODY)).toBeGreaterThan(html.indexOf('<div id="root">'));
      expect(html).toContain("MutationObserver");
    });
  });

  describe("given Vite's bundling page", () => {
    it("swaps its body for the loading screen and keeps the reload scripts", () => {
      const html = brandFallbackPage(VITE_FALLBACK);
      expect(html).not.toContain("Bundling in progress");
      expect(html).toContain(BOOT_SPLASH_BODY);
      expect(html).toContain("__vite_is_fallback_page__");
      expect(html).toContain("/* hmr client */");
    });
  });

  describe("given any other page", () => {
    it("leaves it as it is", () => {
      const page = "<html><body><h1>Bundling in progress</h1></body></html>";
      expect(brandFallbackPage(page)).toBe(page);
    });
  });
});
