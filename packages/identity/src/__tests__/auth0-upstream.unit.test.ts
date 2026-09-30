import { describe, expect, it } from "vitest";
import {
  derivedAccountId,
  sourceOfDerivedAccountId,
  upstreamOfAuth0Subject,
} from "../auth0-upstream";

describe("the Auth0 upstream subject unfolding", () => {
  describe("given a subject naming a native upstream", () => {
    it("unfolds a Google subject to the sub Google itself asserts", () => {
      expect(upstreamOfAuth0Subject("google-oauth2|107698336211125")).toEqual({
        providerId: "google",
        providerAccountId: "107698336211125",
      });
    });

    it("unfolds a GitHub subject to its numeric user id", () => {
      expect(upstreamOfAuth0Subject("github|8391612")).toEqual({
        providerId: "github",
        providerAccountId: "8391612",
      });
    });
  });

  describe("given a subject naming no upstream we can act on", () => {
    /** @scenario "An Auth0-brokered social account is adopted under its own provider too" */
    it("derives nothing for the broker's own database users", () => {
      expect(upstreamOfAuth0Subject("auth0|64f1c9")).toBeNull();
    });

    it("derives nothing for enterprise and Microsoft strategies", () => {
      // samlp is D09's per-tenant wizard; Microsoft's issuer only a real
      // token can name — see the module docblock.
      expect(upstreamOfAuth0Subject("samlp|okta-conn|sam")).toBeNull();
      expect(upstreamOfAuth0Subject("waad|AbC1234")).toBeNull();
      expect(upstreamOfAuth0Subject("windowslive|00341")).toBeNull();
    });

    it("derives nothing from a bare strategy prefix with no subject behind it", () => {
      expect(upstreamOfAuth0Subject("google-oauth2|")).toBeNull();
      expect(upstreamOfAuth0Subject("github|")).toBeNull();
    });

    it("never matches a strategy name that merely shares a prefix", () => {
      expect(upstreamOfAuth0Subject("github-enterprise|8391612")).toBeNull();
    });
  });

  describe("given a derived account id", () => {
    it("derives deterministically and parses back to its source row", () => {
      const id = derivedAccountId({
        sourceAccountId: "acct_1",
        providerId: "google",
      });

      expect(id).toBe(
        derivedAccountId({ sourceAccountId: "acct_1", providerId: "google" }),
      );
      expect(sourceOfDerivedAccountId(id)).toBe("acct_1");
    });

    it("answers null for an ordinary account id", () => {
      expect(sourceOfDerivedAccountId("acct_1")).toBeNull();
      expect(sourceOfDerivedAccountId("drvacct:")).toBeNull();
      expect(sourceOfDerivedAccountId("drvacct:google:")).toBeNull();
    });

    it("keeps two providers' derivations from one source row distinct", () => {
      const google = derivedAccountId({
        sourceAccountId: "acct_1",
        providerId: "google",
      });
      const github = derivedAccountId({
        sourceAccountId: "acct_1",
        providerId: "github",
      });

      expect(google).not.toBe(github);
      expect(sourceOfDerivedAccountId(google)).toBe("acct_1");
      expect(sourceOfDerivedAccountId(github)).toBe("acct_1");
    });
  });
});
