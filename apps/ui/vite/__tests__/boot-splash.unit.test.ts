/**
 * The loading screen as plain HTML: in every index.html's root, and over Vite's bundling page.
 * @vitest-environment node
 */

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { BOOT_SPLASH_BODY, bootSplash, brandFallbackPage, bundleBootGround } from "../boot-splash";

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

/** A minified bundle may hold `$\``, `$'` or `$&`, which a string replacement would expand. */
const GROUND_WITH_PATTERNS = 'var a=`$``,b="$\'",c="$&";';

async function transform(html: string, ground = GROUND): Promise<string> {
  const hook = bootSplash({ bundleGround: async () => ground }).transformIndexHtml;
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

    it("inlines a ground script holding replacement patterns as written", async () => {
      const page = '<html><head></head><body><div id="root"></div></body></html>';
      const html = await transform(page, GROUND_WITH_PATTERNS);
      expect(html).toContain(`<script data-boot-splash>${GROUND_WITH_PATTERNS}</script>`);
      expect(html.match(/<head>/g)).toHaveLength(1);
    });

    it("holds the screen while the app shows its own loading screen", async () => {
      const html = await transform('<html><head></head><body><div id="root"></div></body></html>');
      expect(html).toContain('[data-testid="loading-screen"]');
    });

    it("says it is connecting, counts down to each retry, and says when the server answers", async () => {
      const html = await transform('<html><head></head><body><div id="root"></div></body></html>');
      const script = [...html.matchAll(/<script data-boot-splash>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .find((code) => code?.includes("MutationObserver"));
      if (!script) throw new Error("expected the hand-off script");
      const note = { textContent: "", setAttribute: () => undefined };
      const splash = { isConnected: true };
      const timers: { run: () => void; repeat: boolean }[] = [];
      let healthy = false;
      runInNewContext(script, {
        document: {
          getElementById: (id: string) =>
            ({ "lw-boot": splash, root: {}, "lw-boot-note": note })[id],
        },
        MutationObserver: class {
          observe() {}
        },
        setTimeout: (run: () => void) => timers.push({ run, repeat: false }),
        setInterval: (run: () => void) => timers.push({ run, repeat: true }),
        clearInterval: () => undefined,
        fetch: async () => ({ ok: healthy }),
      });
      const flush = () => new Promise((resolve) => setImmediate(resolve));
      timers.shift()?.run();
      expect(note.textContent).toBe("Connecting to the server…");
      await flush();
      expect(note.textContent).toBe("Can't reach the server yet. Trying again in 2s…");
      const tick = timers.find((timer) => timer.repeat);
      tick?.run();
      expect(note.textContent).toBe("Can't reach the server yet. Trying again in 1s…");
      healthy = true;
      tick?.run();
      expect(note.textContent).toBe("Connecting to the server…");
      await flush();
      expect(note.textContent).toBe("Connected. Opening LangWatch…");
    });
  });

  describe("given the theme provider writes into the root before the app draws", () => {
    /** @scenario "The theme provider's style and script do not count as a drawn page" */
    it("holds the screen until a real page is in the root", async () => {
      const html = await transform('<html><head></head><body><div id="root"></div></body></html>');
      const script = [...html.matchAll(/<script data-boot-splash>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .find((code) => code?.includes("MutationObserver"));
      if (!script) throw new Error("expected the hand-off script");
      const children: { tagName: string }[] = [];
      const root = {
        children,
        get firstElementChild() {
          return children[0];
        },
        querySelector: () => null,
      };
      let removed = false;
      let mutated = () => undefined as void;
      runInNewContext(script, {
        document: {
          getElementById: (id: string) =>
            ({ "lw-boot": { isConnected: true, remove: () => (removed = true) }, root })[id],
          dispatchEvent: () => true,
        },
        Event: class {},
        MutationObserver: class {
          constructor(callback: () => void) {
            mutated = callback;
          }
          observe() {}
          disconnect() {}
        },
        matchMedia: () => ({ matches: true }),
        setTimeout: () => 0,
        clearInterval: () => undefined,
      });
      children.push({ tagName: "STYLE" }, { tagName: "SCRIPT" });
      mutated();
      expect(removed).toBe(false);
      children.push({ tagName: "DIV" });
      mutated();
      expect(removed).toBe(true);
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
      expect(html).toContain("Building the app\\u2026");
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).not.toContain("…");
    });

    it("reloads itself once the server serves the app, even if Vite's reload never came", async () => {
      const html = brandFallbackPage({ html: VITE_FALLBACK });
      const script = [...html.matchAll(/<script data-boot-splash>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .find((code) => code?.includes("location.reload"));
      if (!script) throw new Error("expected the reload probe");
      let served = VITE_FALLBACK;
      let reloads = 0;
      const ticks: (() => void)[] = [];
      const page = {
        document: { getElementById: () => null },
        location: { href: "/project/traces", reload: () => (reloads += 1) },
        setTimeout: () => 0,
        setInterval: (tick: () => void) => ticks.push(tick),
        fetch: async () => ({ ok: true, text: async () => served }),
      };
      runInNewContext(script, page);
      const tick = async () => {
        for (const run of ticks) run();
        await new Promise((resolve) => setImmediate(resolve));
      };
      await tick();
      expect(reloads).toBe(0);
      served = '<html><body><div id="root"></div></body></html>';
      await tick();
      expect(reloads).toBe(1);
    });
  });

  describe("given Vite's bundling page and a ground script holding replacement patterns", () => {
    it("inlines the script as written", () => {
      const html = brandFallbackPage({ html: VITE_FALLBACK, ground: GROUND_WITH_PATTERNS });
      expect(html).toContain(GROUND_WITH_PATTERNS);
      expect(html.match(/<body/g)).toHaveLength(1);
    });
  });

  describe("given the live ground script built for the page", () => {
    /** @scenario "The boot screen's live ground carries no date and time polyfill" */
    it("carries no Temporal polyfill", async () => {
      const script = await bundleBootGround({ minify: true });

      // Booleans, so a failure does not print the whole bundle.
      expect(script.includes("u_colors")).toBe(true);
      expect(/Temporal|PlainDateTime/.test(script)).toBe(false);
    }, 60_000);
  });

  describe("given any other page", () => {
    it("leaves it as it is", () => {
      const page = "<html><body><h1>Bundling in progress</h1></body></html>";
      expect(brandFallbackPage({ html: page, ground: GROUND })).toBe(page);
    });
  });
});
