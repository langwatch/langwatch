// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it, vi } from "vitest";
import {
  configuredSsoProviderStatus,
  extractEmailDomain,
  isSsoProviderMatch,
  matchesConfiguredSsoProvider,
} from "../matching";

describe("isSsoProviderMatch", () => {
  describe("when the org has no ssoProvider", () => {
    /** @scenario isSsoProviderMatch — org without ssoProvider */
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
    /** @scenario isSsoProviderMatch — direct provider name match */
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
    /** @scenario isSsoProviderMatch — Auth0 prefix match */
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
    /** @scenario isSsoProviderMatch — wrong provider rejected */
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

describe("matchesConfiguredSsoProvider", () => {
  const orgWith = (ssoProvider: string | null) => ({
    findByDomain: vi
      .fn()
      .mockResolvedValue(
        ssoProvider === null
          ? null
          : { id: "org_1", name: "Acme", ssoProvider },
      ),
  });

  describe("when there are no accounts to check", () => {
    it("returns false", async () => {
      const organizations = orgWith("auth0");

      const result = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [],
      });

      expect(result).toBe(false);
    });
  });

  describe("when no organization claims the domain", () => {
    it("returns false without asking isSsoProviderMatch anything", async () => {
      const organizations = orgWith(null);

      const result = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [{ providerId: "google", accountId: "sub-1" }],
      });

      expect(result).toBe(false);
      expect(organizations.findByDomain).toHaveBeenCalledWith({
        domain: "acme.com",
      });
    });
  });

  describe("when the organization's pin is a provider name and the account matches it", () => {
    it("returns true", async () => {
      const organizations = orgWith("auth0");

      const result = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [{ providerId: "auth0", accountId: "sub-1" }],
      });

      expect(result).toBe(true);
    });
  });

  describe("when the organization's pin is a providerAccountId prefix the account's id starts with", () => {
    // The trap: comparing `ssoProvider` to the account by equality would
    // reject this, since the pin is only a PREFIX of the account id.
    it("returns true", async () => {
      const organizations = orgWith("waad|acme-conn");

      const result = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [
          { providerId: "auth0", accountId: "waad|acme-conn|user-123" },
        ],
      });

      expect(result).toBe(true);
    });
  });

  describe("when the account matches neither the provider name nor the prefix", () => {
    it("returns false", async () => {
      const organizations = orgWith("okta");

      const result = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [{ providerId: "google", accountId: "sub-1" }],
      });

      expect(result).toBe(false);
    });
  });

  describe("when the user holds several accounts and only the second matches", () => {
    it("reports satisfied with exactly one organization lookup", async () => {
      const organizations = orgWith("auth0");

      const result = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [
          { providerId: "credential", accountId: "user-1" },
          { providerId: "auth0", accountId: "sub-1" },
        ],
      });

      expect(result).toBe(true);
      expect(organizations.findByDomain).toHaveBeenCalledOnce();
    });
  });

  describe("given the same organization and accounts, asked by two different callers", () => {
    it("the sign-in hook and the status read reach the same answer", async () => {
      const organizations = orgWith("waad|acme-conn");
      const account = { providerId: "auth0", accountId: "waad|acme-conn|u-1" };

      // The hook asks about the single account it just saw.
      const hookAnswer = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [account],
      });
      // The status read asks about every account the user holds.
      const statusReadAnswer = await matchesConfiguredSsoProvider({
        organizations,
        domain: "acme.com",
        accounts: [account],
      });

      expect(hookAnswer).toBe(statusReadAnswer);
      expect(hookAnswer).toBe(true);
    });
  });
});

describe("configuredSsoProviderStatus", () => {
  const orgWith = (ssoProvider: string | null) => ({
    findByDomain: vi
      .fn()
      .mockResolvedValue({ id: "org_1", name: "Acme", ssoProvider }),
  });
  const googleAccount = { providerId: "google", accountId: "sub-1" };

  describe("when no organization claims the domain", () => {
    it("answers unconfigured, since there is nothing to satisfy", async () => {
      const organizations = { findByDomain: vi.fn().mockResolvedValue(null) };

      await expect(
        configuredSsoProviderStatus({
          organizations,
          domain: "acme.com",
          accounts: [googleAccount],
        }),
      ).resolves.toBe("unconfigured");
    });
  });

  describe("when the organization claims the domain but pins no provider", () => {
    it("answers unconfigured, since a dropped pin names nothing", async () => {
      await expect(
        configuredSsoProviderStatus({
          organizations: orgWith(null),
          domain: "acme.com",
          accounts: [googleAccount],
        }),
      ).resolves.toBe("unconfigured");
    });
  });

  describe("when the organization pins a provider none of the accounts satisfy", () => {
    it("answers unmatched", async () => {
      await expect(
        configuredSsoProviderStatus({
          organizations: orgWith("okta"),
          domain: "acme.com",
          accounts: [googleAccount],
        }),
      ).resolves.toBe("unmatched");
    });
  });

  describe("when one of the accounts satisfies the pin", () => {
    it("answers matched", async () => {
      await expect(
        configuredSsoProviderStatus({
          organizations: orgWith("google"),
          domain: "acme.com",
          accounts: [googleAccount],
        }),
      ).resolves.toBe("matched");
    });
  });
});
