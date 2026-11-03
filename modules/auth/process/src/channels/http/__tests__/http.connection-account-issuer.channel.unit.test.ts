/**
 * A connection account row is never written without the issuer it belongs to (ADR-189).
 * Spec: specs/identity/account-issuer-namespace.feature
 */
import { describe, expect, it } from "vitest";

import { refuseConnectionAccountWithoutIssuer } from "../http.better-auth-hooks.channel.ts";

const CONNECTION = "ssoc_acme";

describe("refuseConnectionAccountWithoutIssuer", () => {
  describe("when a connection row has no recorded issuer", () => {
    /** @scenario "A connection account row with no recorded issuer is refused when written" */
    it.each([CONNECTION, "local_ssoc_acme"])("refuses %s as not linked", (providerId) => {
      expect(() =>
        refuseConnectionAccountWithoutIssuer({
          account: { providerId },
          assertedIssuers: [],
        }),
      ).toThrow(
        expect.objectContaining({
          body: expect.objectContaining({ code: "OAuthAccountNotLinked" }),
        }),
      );
    });
  });

  describe("when the assertion recorded an issuer for the subject", () => {
    /** @scenario "A connection account row with no recorded issuer is refused when written" */
    it("writes it", () => {
      expect(() =>
        refuseConnectionAccountWithoutIssuer({
          account: { providerId: CONNECTION },
          assertedIssuers: ["https://idp.acme.test"],
        }),
      ).not.toThrow();
    });
  });

  describe("when the row states its own issuer", () => {
    it("writes it, as a confirmed link proposal does", () => {
      expect(() =>
        refuseConnectionAccountWithoutIssuer({
          account: { providerId: CONNECTION, issuer: "https://idp.acme.test" },
          assertedIssuers: [],
        }),
      ).not.toThrow();
    });
  });

  describe("when the provider is not a connection", () => {
    /** @scenario "A connection account row with no recorded issuer is refused when written" */
    it.each(["google", "credential", "okta", "microsoft", "ssocmd_acme"])(
      "writes a %s row as before",
      (providerId) => {
        expect(() =>
          refuseConnectionAccountWithoutIssuer({ account: { providerId }, assertedIssuers: [] }),
        ).not.toThrow();
      },
    );
  });
});
