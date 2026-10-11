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

const GROUND = "window.__ground = true;";

async function transform(html: string): Promise<string> {
  const hook = bootSplash({ bundleGround: async () => GROUND }).transformIndexHtml;
  if (!hook || typeof hook === "function") throw new Error("expected an ordered hook");
  return (await hook.handler.call({} as never, html, {} as never)) as string;
}

describe("the boot splash", () => {
  describe("given the app's index.html", () => {
    it("lays the loading screen over the page, outside the root React draws into", async () => {
      const html = await transform('<html><head></head><body><div id="root"></div></body></html>');
      expect(html).toContain('<div id="root"></div>');
      expect(html.indexOf(BOOT_SPLASH_BODY)).toBeGreaterThan(html.indexOf('<div id="root">'));
      expect(html).toContain("MutationObserver");
    });

    it("inlines the live ground's script, so it runs before the app bundle", async () => {
      const html = await transform('<html><head></head><body><div id="root"></div></body></html>');
      expect(html).toContain(`<script data-boot-splash>${GROUND}</script>`);
      expect(html).not.toContain('type="module" src="/src/boot-ground.ts"');
    });

    it("holds the screen while the app shows its own loading screen", async () => {
      const html = await transform('<html><head></head><body><div id="root"></div></body></html>');
      expect(html).toContain('[data-testid="loading-screen"]');
      expect(html).toContain("Waiting for the server…");
    });
  });

  describe("given Vite's bundling page", () => {
    it("swaps its body for the loading screen and keeps the reload scripts", () => {
      const html = brandFallbackPage({ html: VITE_FALLBACK, ground: GROUND });
      expect(html).not.toContain("Bundling in progress");
      expect(html).toContain(BOOT_SPLASH_BODY);
      expect(html).toContain("__vite_is_fallback_page__");
      expect(html).toContain("/* hmr client */");
      expect(html).toContain(GROUND);
      expect(html).toContain("Building the app…");
    });
  });

  describe("given any other page", () => {
    it("leaves it as it is", () => {
      const page = "<html><body><h1>Bundling in progress</h1></body></html>";
      expect(brandFallbackPage({ html: page, ground: GROUND })).toBe(page);
    });
  });
});
