import { describe, expect, it } from "vitest";

import { cloudflareTrustOf } from "../config-owner.ts";

describe("cloudflareTrustOf", () => {
  describe("when TRUST_CLOUDFLARE_CLIENT_IP is on and no trusted proxy is declared", () => {
    /** @scenario "TRUST_CLOUDFLARE_CLIENT_IP with no trusted proxy addresses refuses to boot" */
    it.each([undefined, []])("refuses the configuration naming both settings (%j)", (proxies) => {
      expect(() => cloudflareTrustOf({ trustCloudflare: true, trustedProxies: proxies })).toThrow(
        /TRUST_CLOUDFLARE_CLIENT_IP.*TRUSTED_PROXY_ADDRESSES/,
      );
    });
  });

  describe("when the flag is on beside a declared set", () => {
    it("trusts Cloudflare's header", () => {
      expect(
        cloudflareTrustOf({ trustCloudflare: true, trustedProxies: ["173.245.48.0/20"] }),
      ).toBe(true);
    });
  });

  describe("when the flag is off", () => {
    it("does not trust Cloudflare's header, with or without a set", () => {
      expect(cloudflareTrustOf({ trustCloudflare: false, trustedProxies: undefined })).toBe(false);
    });
  });
});
