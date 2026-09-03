import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "../app-static.security-headers";

describe("buildSecurityHeaders", () => {
  /** @scenario Production HTTP responses include the Permissions-Policy header */
  it("disables unused browser capabilities in production", () => {
    const headers = buildSecurityHeaders({
      dev: false,
      environment: {},
    });

    expect(headers["Permissions-Policy"]).toBe(
      "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    );
    expect(headers["Content-Security-Policy"]).toBeDefined();
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("keeps the capability restrictions on development responses", () => {
    const headers = buildSecurityHeaders({
      dev: true,
      environment: {},
    });

    expect(headers["Permissions-Policy"]).toBe(
      "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    );
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  describe("given a content-hashed asset CDN (ADR-086)", () => {
    const CDN = "https://cdn.langwatch.ai";
    const FETCH_DIRECTIVES = [
      "script-src",
      "style-src",
      "font-src",
      "img-src",
      "connect-src",
      "worker-src",
    ];

    function directive(csp: string, name: string): string {
      const found = csp.split("; ").find((d) => d === name || d.startsWith(`${name} `));
      if (!found) throw new Error(`directive ${name} not found in CSP`);
      return found;
    }

    function csp(assetOrigin: string | null): string {
      const header = buildSecurityHeaders({
        dev: false,
        environment: {},
        assetOrigin,
      })["Content-Security-Policy"];
      if (!header) throw new Error("expected a CSP header in production");
      return header;
    }

    describe("when no asset origin is configured (self-host)", () => {
      /** @scenario No CDN origin is added for same-origin serving */
      it("adds no external asset origin to the fetch directives", () => {
        const header = csp(null);

        for (const name of FETCH_DIRECTIVES) {
          expect(directive(header, name)).not.toContain(CDN);
        }
      });
    });

    describe("when a CDN asset origin is configured", () => {
      // Regression guard: dropping the origin from one directive (e.g.
      // worker-src, which Shiki/Monaco need) would otherwise ship green.
      /** @scenario The CDN origin is added to the fetch directives */
      it("admits the origin into every fetch directive the browser needs", () => {
        const header = csp(CDN);

        for (const name of FETCH_DIRECTIVES) {
          expect(directive(header, name)).toContain(CDN);
        }
      });

      it("leaves directives that never fetch assets untouched", () => {
        const header = csp(CDN);

        expect(directive(header, "frame-src")).not.toContain(CDN);
        expect(directive(header, "default-src")).not.toContain(CDN);
      });
    });
  });
});
