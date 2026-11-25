import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { apiOwner, cloudflareTrustOf } from "../config-owner.ts";

describe("cloudflareTrustOf", () => {
  describe("when TRUST_CLOUDFLARE_CLIENT_IP is on and no trusted proxy is declared", () => {
    /** @scenario "TRUST_CLOUDFLARE_CLIENT_IP with no trusted proxy addresses refuses to boot" */
    it.each([undefined, []])("refuses the configuration naming both settings (%j)", (proxies) => {
      expect(() => cloudflareTrustOf({ trustCloudflare: true, trustedProxies: proxies })).toThrow(
        expect.objectContaining({ code: "config_refused" }),
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

describe("TRUSTED_PROXY_ADDRESSES", () => {
  const parsed = (value: string) =>
    parseProcessConfig({ owners: [apiOwner], environment: { TRUSTED_PROXY_ADDRESSES: value } }).http
      .trustedProxies;

  describe("when every entry is an address or a range", () => {
    it("reads IPv4 and IPv6 addresses and ranges", () => {
      expect(parsed("10.0.0.0/8, 192.0.2.1,2400:cb00::/32,::1")).toEqual([
        "10.0.0.0/8",
        "192.0.2.1",
        "2400:cb00::/32",
        "::1",
      ]);
    });
  });

  describe("when an entry is an IPv4-mapped IPv6 range", () => {
    it.each(["::ffff:10.0.0.0/104", "::ffff:a00:0/104", "::ffff:10.0.0.0/96", "::ffff:a00:0/96"])(
      "reads it, since the mapped block is an IPv4 range (%s)",
      (entry) => {
        expect(parsed(entry)).toEqual([entry]);
      },
    );

    it.each(["::ffff:10.0.0.0/80", "::ffff:a00:0/80", "0:0:0:0:0:FFFF:a00:0/80", "::/80", "::/0"])(
      "refuses a range wider than the mapped block, which would trust every IPv4 peer (%s)",
      (entry) => {
        expect(() => parsed(`10.0.0.0/8,${entry}`)).toThrow(entry);
      },
    );

    it("reads an IPv6 range that does not reach the mapped block", () => {
      expect(parsed("fc00::/7,2001:db8::/32")).toEqual(["fc00::/7", "2001:db8::/32"]);
    });
  });

  describe("when an entry is a hostname or a malformed range", () => {
    /** @scenario "An unreadable trusted proxy entry refuses to boot" */
    it.each([
      "ingress.internal",
      "10.0.0.0/33",
      "10.0.0.0/8/1",
      "2400:cb00::/129",
      "10.0.0.0/x",
      "::ffff:10.0.0.0/64",
    ])("refuses the configuration (%s)", (entry) => {
      expect(() => parsed(`10.0.0.0/8,${entry}`)).toThrow(entry);
    });
  });
});
