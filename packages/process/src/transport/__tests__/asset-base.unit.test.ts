import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { BrowserBundle, SessionReader } from "@langwatch/api/hosting";
import { browserBundleDefaults } from "@langwatch/api/policy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assetBaseBootstrapBody, assetBaseOrigin, normalizeAssetBase } from "../asset-base.ts";
import { resolveUiBundle } from "../bundle-config.ts";

const ENTRY = "/assets/index-deadbeef.js";
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "asset-base-"));
  fs.writeFileSync(
    path.join(directory, "index.html"),
    `<html><head><script type="module" src="${ENTRY}"></script></head><body>app</body></html>`,
  );
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

/** What the browser sees: the bootstrap run against a window, then the resolver it left. */
function resolverFor(base: string): (assetPath: string) => string {
  const window: Record<string, unknown> = {};
  vm.runInNewContext(assetBaseBootstrapBody(base), { window });
  return window.__lwAssetUrl as (assetPath: string) => string;
}

/** The shell as a client requesting `address` is served it by the real bundle. */
async function served({ assetBase, address }: { assetBase?: string; address: string }) {
  const bundle = resolveUiBundle({ directory, assetBase, publicConfig: {} });
  if (!bundle) throw new Error("the fixture has a build");
  const response = await BrowserBundle.create({
    dist: bundle.directory,
    publicConfig: () => bundle.head,
    sessionReader: SessionReader.unverified(),
    security: browserBundleDefaults({ production: true, assetOrigin: bundle.assetOrigin }),
  }).fetch(new Request(`http://localhost${address}`));
  return { response, body: await response.text() };
}

describe("given LANGWATCH_ASSET_BASE is unset", () => {
  describe("when a client loads the app", () => {
    /** @scenario With no asset base set, assets are served same-origin from the pod */
    it("resolves every asset under /assets/ on the same origin", () => {
      const resolve = resolverFor(normalizeAssetBase(void 0));

      expect(resolve("assets/x.js")).toBe("/assets/x.js");
      expect(assetBaseOrigin(normalizeAssetBase(void 0))).toBeNull();
    });
  });

  describe("when a client requests a page address", () => {
    /** @scenario The resolver is injected even when serving same-origin */
    it("defines window.__lwAssetUrl in the body, answering the same-origin path", async () => {
      const { body } = await served({ address: "/projects/foo/traces" });

      expect(body).toContain("window.__lwAssetUrl=");
      expect(resolverFor("/")("assets/x.js")).toBe("/assets/x.js");
    });

    /** @scenario Same-origin rewriting is a no-op for the entry references */
    it("still references the entry script at /assets/", async () => {
      const { body } = await served({ address: "/" });

      expect(body).toContain(`src="${ENTRY}"`);
    });

    /** @scenario Unknown non-asset route falls back to index.html for SPA routing */
    it("answers 200 text/html carrying index.html and the injected resolver", async () => {
      const { response, body } = await served({ address: "/projects/foo/traces" });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(body).toContain("<body>app</body>");
      expect(body).toContain("window.__lwAssetUrl=");
    });
  });

  describe("when the Content-Security-Policy is built", () => {
    /** @scenario No CDN origin is added for same-origin serving */
    it("names no external origin in script-src", async () => {
      const { response } = await served({ address: "/" });
      const scriptSource = directive(response, "script-src");

      expect(scriptSource).toContain("script-src 'self'");
      expect(scriptSource).not.toContain("langwatch.ai");
    });
  });
});

describe("given LANGWATCH_ASSET_BASE is a CDN address", () => {
  describe("when a client loads the app", () => {
    /** @scenario A CDN base resolves assets to the CDN, with or without a trailing slash */
    it.each(["https://cdn.langwatch.ai/abc123", "https://cdn.langwatch.ai/abc123/"])(
      "requests assets from the CDN under /assets/ for %s",
      (base) => {
        const resolve = resolverFor(normalizeAssetBase(base));

        expect(resolve("assets/x.js")).toBe("https://cdn.langwatch.ai/abc123/assets/x.js");
      },
    );
  });

  describe("when the Content-Security-Policy is built", () => {
    /** @scenario The CDN origin is added to the fetch directives */
    it("admits the origin to script, style, font and connect sources", async () => {
      const { response } = await served({
        assetBase: "https://cdn.langwatch.ai/abc123/",
        address: "/",
      });

      for (const name of ["script-src", "style-src", "font-src", "connect-src"]) {
        expect(directive(response, name), name).toContain("https://cdn.langwatch.ai");
      }
    });
  });
});

describe("given LANGWATCH_ASSET_BASE has no scheme", () => {
  describe("when the app starts", () => {
    /** @scenario A misconfigured base fails fast instead of silently serving 404s */
    it("refuses to build the bundle, naming LANGWATCH_ASSET_BASE", () => {
      expect(() =>
        resolveUiBundle({ directory, assetBase: "cdn.langwatch.ai/abc123/", publicConfig: {} }),
      ).toThrow(/LANGWATCH_ASSET_BASE/);
    });
  });
});

function directive(response: Response, name: string): string {
  const policy =
    response.headers.get("content-security-policy") ??
    response.headers.get("content-security-policy-report-only") ??
    "";
  return (
    policy
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}
