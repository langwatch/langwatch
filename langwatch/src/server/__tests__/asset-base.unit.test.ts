import { describe, expect, it } from "vitest";

import {
  ASSET_URL_GLOBAL,
  assetBaseBootstrapScript,
  assetBaseOrigin,
  injectAssetBaseIntoHtml,
  normalizeAssetBase,
} from "../asset-base";

const CDN = "https://cdn.langwatch.ai/abc123/";

/**
 * Execute the injected bootstrap against a stub `window` and return the real
 * `__lwAssetUrl` resolver, so the tests exercise the JS the browser actually
 * runs rather than a re-implementation of it.
 */
function evalResolver(base: string): (p: string) => string {
  const inner = /<script>([\s\S]*?)<\/script>/.exec(
    assetBaseBootstrapScript(base),
  )?.[1];
  if (!inner) throw new Error("bootstrap script had no body");
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("window", inner)(win);
  return win[ASSET_URL_GLOBAL] as (p: string) => string;
}

describe("normalizeAssetBase", () => {
  describe("when the value is absent or same-origin", () => {
    it("maps undefined to the same-origin sentinel", () => {
      expect(normalizeAssetBase(undefined)).toBe("/");
    });

    it("maps an empty or whitespace value to the same-origin sentinel", () => {
      expect(normalizeAssetBase("")).toBe("/");
      expect(normalizeAssetBase("   ")).toBe("/");
    });

    it("maps a bare slash to the same-origin sentinel", () => {
      expect(normalizeAssetBase("/")).toBe("/");
    });
  });

  describe("when the value is a CDN base", () => {
    it("appends a trailing slash when missing", () => {
      expect(normalizeAssetBase("https://cdn.langwatch.ai/abc123")).toBe(CDN);
    });

    it("leaves an existing trailing slash intact", () => {
      expect(normalizeAssetBase(CDN)).toBe(CDN);
    });

    it("trims surrounding whitespace", () => {
      expect(normalizeAssetBase(`  ${CDN}  `)).toBe(CDN);
    });
  });
});

describe("assetBaseOrigin", () => {
  describe("when the base is same-origin", () => {
    it("returns null so nothing is added to the CSP", () => {
      expect(assetBaseOrigin("/")).toBeNull();
    });
  });

  describe("when the base is an external CDN", () => {
    it("returns just the origin, dropping the commit-prefix path", () => {
      expect(assetBaseOrigin(CDN)).toBe("https://cdn.langwatch.ai");
    });
  });
});

describe("the injected resolver", () => {
  describe("when the base is same-origin", () => {
    it("prefixes a relative asset path with a leading slash", () => {
      expect(evalResolver("/")("assets/x.js")).toBe("/assets/x.js");
    });
  });

  describe("when the base is a CDN", () => {
    it("prefixes a relative asset path with the full CDN base", () => {
      expect(evalResolver(CDN)("assets/x.js")).toBe(`${CDN}assets/x.js`);
    });
  });
});

describe("injectAssetBaseIntoHtml", () => {
  const shell =
    "<!doctype html><html><head><title>x</title>" +
    '<script type="module" src="/assets/index-deadbeef.js"></script>' +
    '<link rel="stylesheet" href="/assets/index-cafe.css"></head>' +
    '<body><div id="root"></div></body></html>';

  describe("when the base is same-origin", () => {
    it("injects the resolver bootstrap into the head", () => {
      const out = injectAssetBaseIntoHtml(shell, "/");
      expect(out).toContain(`window.${ASSET_URL_GLOBAL}`);
      // bootstrap lands inside <head>, before the entry script
      expect(out.indexOf(ASSET_URL_GLOBAL)).toBeLessThan(
        out.indexOf("index-deadbeef.js"),
      );
    });

    it("leaves the base-absolute entry references untouched", () => {
      const out = injectAssetBaseIntoHtml(shell, "/");
      expect(out).toContain('src="/assets/index-deadbeef.js"');
      expect(out).toContain('href="/assets/index-cafe.css"');
    });
  });

  describe("when the base is a CDN", () => {
    it("rewrites the entry script and stylesheet to the CDN base", () => {
      const out = injectAssetBaseIntoHtml(shell, CDN);
      expect(out).toContain(`src="${CDN}assets/index-deadbeef.js"`);
      expect(out).toContain(`href="${CDN}assets/index-cafe.css"`);
      expect(out).not.toContain('src="/assets/');
    });

    it("still injects the resolver and points it at the CDN", () => {
      const out = injectAssetBaseIntoHtml(shell, CDN);
      expect(out).toContain(`window.${ASSET_URL_GLOBAL}`);
      expect(out).toContain(JSON.stringify(CDN));
    });

    it("does not rewrite same-origin public assets like the favicon", () => {
      const withFavicon = injectAssetBaseIntoHtml(
        '<html><head><link rel="icon" href="/favicon.ico"></head></html>',
        CDN,
      );
      expect(withFavicon).toContain('href="/favicon.ico"');
    });
  });

  describe("when the shell has no head or html tag", () => {
    it("still injects the resolver without dropping existing markup", () => {
      const out = injectAssetBaseIntoHtml(
        "<!doctype html><body><div id=root></div></body>",
        "/",
      );
      expect(out).toContain(`window.${ASSET_URL_GLOBAL}`);
      expect(out).toContain("<div id=root>");
    });
  });
});
