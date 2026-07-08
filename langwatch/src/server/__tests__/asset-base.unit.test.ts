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

  describe("when the value is not an absolute http(s) URL", () => {
    it("throws on a scheme-less value that would silently break assets", () => {
      // Without this, the rewrite emits a broken *relative* url and the CSP
      // (via new URL()) drops the origin — the silent-404 this feature fixes.
      expect(() => normalizeAssetBase("cdn.langwatch.ai/abc123/")).toThrow(
        /absolute http\(s\) URL/,
      );
    });

    it("throws on a non-http(s) scheme", () => {
      expect(() =>
        normalizeAssetBase("ftp://cdn.langwatch.ai/abc123/"),
      ).toThrow(/http or https/);
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

  describe("when the base does not parse as a URL", () => {
    it("returns null rather than throwing (defensive)", () => {
      expect(assetBaseOrigin("not a url/")).toBeNull();
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

    it("treats a $ in the base literally, not as a replacement token", () => {
      const out = injectAssetBaseIntoHtml(shell, "https://cdn.example.com/a$1b/");
      expect(out).toContain(
        'src="https://cdn.example.com/a$1b/assets/index-deadbeef.js"',
      );
    });
  });

  describe("when the shell lacks one of the injection anchors", () => {
    it("injects after the doctype when there is no head or html tag", () => {
      const out = injectAssetBaseIntoHtml(
        "<!doctype html><body><div id=root></div></body>",
        "/",
      );
      expect(out).toContain(`window.${ASSET_URL_GLOBAL}`);
      expect(out).toContain("<div id=root>");
    });

    it("injects after <html> when there is no <head>", () => {
      const out = injectAssetBaseIntoHtml(
        "<html><body><div id=root></div></body></html>",
        "/",
      );
      expect(out).toContain(`window.${ASSET_URL_GLOBAL}`);
      expect(out.indexOf(ASSET_URL_GLOBAL)).toBeLessThan(
        out.indexOf("<div id=root>"),
      );
    });

    it("prepends the bootstrap when there is no doctype/html/head", () => {
      const out = injectAssetBaseIntoHtml("<div id=root></div>", "/");
      expect(out.startsWith("<script>")).toBe(true);
      expect(out).toContain("<div id=root>");
    });
  });
});
