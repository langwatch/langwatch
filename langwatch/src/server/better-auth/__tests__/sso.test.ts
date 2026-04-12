import { describe, expect, it } from "vitest";
import { extractEmailDomain, isSsoProviderMatch } from "../sso";

describe("isSsoProviderMatch", () => {
  describe("when the org has no ssoProvider", () => {
    it("returns false even if the account looks like a match", () => {
      expect(
        isSsoProviderMatch(
          { ssoProvider: null },
          { providerId: "google", accountId: "google-sub-123" },
        ),
      ).toBe(false);
    });
  });

  describe("when the org ssoProvider matches the account providerId", () => {
    it("returns true for a direct provider name match", () => {
      expect(
        isSsoProviderMatch(
          { ssoProvider: "google" },
          { providerId: "google", accountId: "google-sub-456" },
        ),
      ).toBe(true);
    });
  });

  describe("when the org ssoProvider is an Auth0 connection prefix", () => {
    it("returns true when providerAccountId starts with the prefix", () => {
      expect(
        isSsoProviderMatch(
          { ssoProvider: "waad|acme-azure-connection" },
          {
            providerId: "auth0",
            accountId: "waad|acme-azure-connection|abc-user-id",
          },
        ),
      ).toBe(true);
    });

    it("returns true when providerAccountId equals the prefix exactly", () => {
      expect(
        isSsoProviderMatch(
          { ssoProvider: "waad|acme-azure-connection" },
          {
            providerId: "auth0",
            accountId: "waad|acme-azure-connection",
          },
        ),
      ).toBe(true);
    });

    it("returns false when providerAccountId does NOT start with the prefix", () => {
      expect(
        isSsoProviderMatch(
          { ssoProvider: "waad|acme-azure-connection" },
          {
            providerId: "auth0",
            accountId: "google-oauth2|other-user-id",
          },
        ),
      ).toBe(false);
    });

    it("rejects a sibling connection that merely shares a literal prefix (CodeRabbit)", () => {
      // Without the `|` delimiter check, an org pinned to `waad|acme`
      // would accept `waad|acme-prod|user-123` — a sibling connection.
      expect(
        isSsoProviderMatch(
          { ssoProvider: "waad|acme" },
          {
            providerId: "auth0",
            accountId: "waad|acme-prod|user-123",
          },
        ),
      ).toBe(false);
    });
  });

  describe("when the wrong provider is used", () => {
    it("returns false", () => {
      expect(
        isSsoProviderMatch(
          { ssoProvider: "okta" },
          { providerId: "google", accountId: "google-sub-123" },
        ),
      ).toBe(false);
    });
  });
});

describe("extractEmailDomain", () => {
  describe("when given a valid email", () => {
    it("returns the lowercased domain", () => {
      expect(extractEmailDomain("user@Acme.COM")).toBe("acme.com");
    });
  });

  describe("when given null or undefined", () => {
    it("returns null", () => {
      expect(extractEmailDomain(null)).toBeNull();
      expect(extractEmailDomain(undefined)).toBeNull();
    });
  });

  describe("when given a malformed email", () => {
    it("returns null for an email with no @", () => {
      expect(extractEmailDomain("not-an-email")).toBeNull();
    });

    it("returns null for an email ending in @", () => {
      expect(extractEmailDomain("user@")).toBeNull();
    });

    it("returns null for an email with multiple @ chars (CodeRabbit)", () => {
      // Without this check, "a@b@c.com" would silently return "b@c.com"
      // and route SSO based on the wrong domain.
      expect(extractEmailDomain("a@b@c.com")).toBeNull();
      expect(extractEmailDomain("user@@acme.com")).toBeNull();
    });
  });
});
