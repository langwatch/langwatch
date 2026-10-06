import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SecurityHeaders } from "../../policy/security-headers.ts";
import { BrowserBundle } from "../browser-bundle.ts";
import { SessionReader } from "../session-reader.ts";

const CDN = "https://cdn.langwatch.ai/abc123/";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function served({ assetBase }: { assetBase?: string }): Promise<string> {
  const dist = await mkdtemp(path.join(tmpdir(), "langwatch-asset-base-"));
  directories.push(dist);
  await mkdir(path.join(dist, "assets"));
  await writeFile(
    path.join(dist, "index.html"),
    `<html><head><script type="module" src="/assets/index-deadbeef.js"></script>` +
      `<link rel="modulepreload" href="/assets/vendor-cafe.js">` +
      `<link rel="stylesheet" href="/assets/index-deadbeef.css">` +
      `<img data-src="/assets/lazy.png"></head><body>app</body></html>`,
  );

  const response = await BrowserBundle.create({
    dist,
    publicConfig: () => "",
    ...(assetBase === void 0 ? {} : { assetBase }),
    sessionReader: SessionReader.unverified(),
    security: SecurityHeaders.strict(),
  }).fetch(new Request("http://localhost/"));

  return response.text();
}

describe("given LANGWATCH_ASSET_BASE is a CDN address", () => {
  describe("when a client requests /", () => {
    /** @scenario Entry script and preload links are rewritten to the CDN base */
    it("references the entry script, preload and stylesheet on the CDN, not the pod", async () => {
      const body = await served({ assetBase: CDN });

      expect(body).toContain(`src="${CDN}assets/index-deadbeef.js"`);
      expect(body).toContain(`href="${CDN}assets/vendor-cafe.js"`);
      expect(body).toContain(`href="${CDN}assets/index-deadbeef.css"`);
      expect(body).not.toMatch(/\ssrc="\/assets\//);
      expect(body).not.toMatch(/\shref="\/assets\//);
      expect(body).toContain('data-src="/assets/lazy.png"');
    });
  });
});

describe("given the asset base is the same origin", () => {
  describe("when a client requests /", () => {
    it.each([void 0, "/"])("leaves every /assets/ link alone for base %s", async (assetBase) => {
      const body = await served(assetBase === void 0 ? {} : { assetBase });

      expect(body).toContain('src="/assets/index-deadbeef.js"');
      expect(body).toContain('href="/assets/vendor-cafe.js"');
    });
  });
});
