import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../csp";

const CDN = "https://cdn.langwatch.ai";

function directive(csp: string, name: string): string {
  const found = csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`directive ${name} not found in CSP`);
  return found;
}

describe("buildContentSecurityPolicy", () => {
  const base = { dev: false, storageEnv: {} };

  describe("when no asset origin is configured (self-host)", () => {
    it("adds no external asset origin to the fetch directives", () => {
      const csp = buildContentSecurityPolicy({ ...base, assetOrigin: null });
      for (const name of [
        "script-src",
        "style-src",
        "font-src",
        "img-src",
        "connect-src",
        "worker-src",
      ]) {
        expect(directive(csp, name)).not.toContain(CDN);
      }
    });
  });

  describe("when a CDN asset origin is configured", () => {
    // Regression guard: dropping `${cdn}` from one directive (e.g. worker-src,
    // which Shiki/Monaco need) would otherwise ship green.
    it("admits the origin into every fetch directive the browser needs", () => {
      const csp = buildContentSecurityPolicy({ ...base, assetOrigin: CDN });
      for (const name of [
        "script-src",
        "style-src",
        "font-src",
        "img-src",
        "connect-src",
        "worker-src",
      ]) {
        expect(directive(csp, name)).toContain(CDN);
      }
    });

    it("does not add it to directives that never fetch assets", () => {
      const csp = buildContentSecurityPolicy({ ...base, assetOrigin: CDN });
      expect(directive(csp, "frame-src")).not.toContain(CDN);
      expect(directive(csp, "default-src")).not.toContain(CDN);
    });
  });

  describe("when object storage is configured", () => {
    it("includes the derived storage origin in connect-src", () => {
      const csp = buildContentSecurityPolicy({
        dev: false,
        assetOrigin: null,
        storageEnv: {
          S3_BUCKET_NAME: "my-bucket",
          S3_REGION: "eu-central-1",
        },
      });
      expect(directive(csp, "connect-src")).toContain(
        "https://s3.eu-central-1.amazonaws.com",
      );
    });
  });

  describe("when dev", () => {
    it("omits upgrade-insecure-requests", () => {
      const csp = buildContentSecurityPolicy({
        dev: true,
        assetOrigin: null,
        storageEnv: {},
      });
      expect(csp).not.toContain("upgrade-insecure-requests");
    });
  });
});
