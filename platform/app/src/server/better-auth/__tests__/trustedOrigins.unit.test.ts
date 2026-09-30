import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "../trustedOrigins";

/**
 * The allowlist an OIDC discovery URL is checked against.
 *
 * better-auth compares an https URL to each entry as `entry === origin(url)`,
 * so an entry that is not a bare origin matches nothing at all — which is why
 * normalisation is the behaviour under test here rather than an
 * implementation detail.
 */

const APP = "https://app.acme.langwatch.localhost";

const resolve = (
  overrides: Partial<Parameters<typeof resolveTrustedOrigins>[0]> = {},
) =>
  resolveTrustedOrigins({
    nextAuthUrl: APP,
    baseHost: undefined,
    trustedIdpOrigins: undefined,
    idpSimulatorUrl: undefined,
    registeredIssuers: [],
    isProduction: false,
    ...overrides,
  });

describe("resolveTrustedOrigins", () => {
  describe("given only the app's own address", () => {
    it("trusts it", () => {
      expect(resolve()).toEqual([APP]);
    });

    it("does not repeat it when the external address is the same", () => {
      expect(resolve({ baseHost: APP })).toEqual([APP]);
    });

    it("trusts the external address too when a proxy makes it differ", () => {
      const external = "https://acme.langwatch.ai";
      expect(resolve({ baseHost: external })).toContain(external);
    });
  });

  describe("given an operator's internal identity providers", () => {
    it("reduces an entry written as a full address to its origin", () => {
      const origins = resolve({
        trustedIdpOrigins: "https://idp.internal.acme.com/realms/acme",
      });
      expect(origins).toContain("https://idp.internal.acme.com");
      expect(origins).not.toContain(
        "https://idp.internal.acme.com/realms/acme",
      );
    });

    it("reads a list written with commas, spaces or both", () => {
      const origins = resolve({
        trustedIdpOrigins:
          "https://one.example.com,  https://two.example.com\nhttps://three.example.com",
      });
      expect(origins).toEqual(
        expect.arrayContaining([
          "https://one.example.com",
          "https://two.example.com",
          "https://three.example.com",
        ]),
      );
    });

    it("keeps a non-default port, which is where a local provider lives", () => {
      expect(resolve({ trustedIdpOrigins: "http://localhost:8080" })).toContain(
        "http://localhost:8080",
      );
    });

    it("drops an entry that is not an address rather than refusing the rest", () => {
      const origins = resolve({
        trustedIdpOrigins: "not-an-address, https://idp.example.com",
      });
      expect(origins).toContain("https://idp.example.com");
      expect(origins).toHaveLength(2);
    });

    it("names an origin once however many times it is listed", () => {
      const origins = resolve({
        trustedIdpOrigins: "https://idp.example.com,https://idp.example.com/x",
      });
      expect(
        origins.filter((origin) => origin === "https://idp.example.com"),
      ).toHaveLength(1);
    });
  });

  describe("given customers have registered their own identity providers", () => {
    it("trusts a registered issuer, since registering it is the declaration", () => {
      expect(
        resolve({ registeredIssuers: ["https://acme.okta.com"] }),
      ).toContain("https://acme.okta.com");
    });

    it("reduces an issuer carrying a tenant path to its origin", () => {
      // The engine compares an https discovery URL to each entry as
      // `entry === origin(url)`, so an entry with a path matches nothing.
      const origins = resolve({
        registeredIssuers: ["https://idp.example.com/t/1"],
      });
      expect(origins).toContain("https://idp.example.com");
      expect(origins).not.toContain("https://idp.example.com/t/1");
    });

    it("names an origin once when two organizations share an issuer host", () => {
      const origins = resolve({
        registeredIssuers: [
          "https://idp.example.com/t/1",
          "https://idp.example.com/t/2",
        ],
      });
      expect(
        origins.filter((origin) => origin === "https://idp.example.com"),
      ).toHaveLength(1);
    });

    it("keeps trusting them in production, which is where customers are", () => {
      expect(
        resolve({
          registeredIssuers: ["https://acme.okta.com"],
          isProduction: true,
        }),
      ).toContain("https://acme.okta.com");
    });

    it("ignores an issuer that is not an address rather than refusing the rest", () => {
      const origins = resolve({
        registeredIssuers: ["", "https://acme.okta.com"],
      });
      expect(origins).toContain("https://acme.okta.com");
      expect(origins).toHaveLength(2);
    });
  });

  describe("given the simulator haven started for this worktree", () => {
    const simulator = "https://idp.acme.langwatch.localhost";

    it("trusts it outside production, so a local registration can be tested", () => {
      expect(resolve({ idpSimulatorUrl: simulator })).toContain(simulator);
    });

    it("refuses it in production, where signing anything asked for is a hole", () => {
      expect(
        resolve({ idpSimulatorUrl: simulator, isProduction: true }),
      ).not.toContain(simulator);
    });

    it("still honours an operator's own list in production", () => {
      const origins = resolve({
        trustedIdpOrigins: "https://idp.internal.acme.com",
        idpSimulatorUrl: simulator,
        isProduction: true,
      });
      expect(origins).toContain("https://idp.internal.acme.com");
    });
  });

  describe("given the app's own address leads the list", () => {
    it("keeps it first, so the resolved list reads the way it was written", () => {
      const origins = resolve({
        trustedIdpOrigins: "https://idp.example.com",
      });
      expect(origins[0]).toBe(APP);
    });
  });
});
