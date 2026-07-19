// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  LOCAL_GATEWAY_URL,
  SAAS_GATEWAY_URL,
  resolveGatewayBaseUrl,
} from "../gatewayUrl";

describe("resolveGatewayBaseUrl", () => {
  describe("given no explicit gateway env vars", () => {
    describe("when the deployment is SaaS", () => {
      it("resolves the canonical .ai gateway host", () => {
        expect(resolveGatewayBaseUrl({ isSaas: true })).toBe(
          "https://gateway.langwatch.ai",
        );
      });

      it("never resolves the parked .com host", () => {
        // Regression: a stale `gateway.langwatch.com` default routed SaaS
        // CLI traffic at a parked DigitalOcean IP whose TLS cert didn't
        // match the host, surfacing as `fetch failed` on `langwatch claude`.
        expect(resolveGatewayBaseUrl({ isSaas: true })).not.toContain(".com");
        expect(SAAS_GATEWAY_URL).toBe("https://gateway.langwatch.ai");
      });
    });

    describe("when the deployment is self-hosted", () => {
      it("resolves the local Go gateway port", () => {
        expect(resolveGatewayBaseUrl({ isSaas: false })).toBe(
          LOCAL_GATEWAY_URL,
        );
      });
    });
  });

  describe("given LW_GATEWAY_PUBLIC_URL is set", () => {
    it("wins over both the legacy base url and the SaaS default", () => {
      expect(
        resolveGatewayBaseUrl({
          publicUrl: "https://gw.acme.example",
          baseUrl: "https://legacy.acme.example",
          isSaas: true,
        }),
      ).toBe("https://gw.acme.example");
    });
  });

  describe("given only the legacy LW_GATEWAY_BASE_URL is set", () => {
    it("falls back to the legacy base url over the SaaS default", () => {
      expect(
        resolveGatewayBaseUrl({
          baseUrl: "https://legacy.acme.example",
          isSaas: true,
        }),
      ).toBe("https://legacy.acme.example");
    });
  });
});
