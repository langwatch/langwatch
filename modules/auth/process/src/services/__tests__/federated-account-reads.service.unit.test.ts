/**
 * The read a peer is answered from when it owns no `Account` row: which
 * providers let this person in, and none of the rows behind them.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import { FederatedAccountReadsService } from "../federated-account-reads.service.ts";

const serviceOver = (rows: { providerId: string; accountId: string }[]) =>
  FederatedAccountReadsService.create({
    accounts: createApiFixture<BetterAuthHooksRepository>({
      findFederatedAccountsForUser: async () => rows,
    }),
  });

describe("given somebody holding accounts through two providers", () => {
  it("names each provider once, whatever the row count", async () => {
    const service = serviceOver([
      { providerId: "google", accountId: "sub-1" },
      { providerId: "local_ssoc_one", accountId: "sub-2" },
      { providerId: "google", accountId: "sub-3" },
    ]);

    await expect(service.findProvidersForUser({ userId: "user_ana" })).resolves.toEqual([
      "google",
      "local_ssoc_one",
    ]);
  });
});

describe("given somebody holding no federated account", () => {
  it("answers with an empty list rather than nothing", async () => {
    await expect(serviceOver([]).findProvidersForUser({ userId: "user_ana" })).resolves.toEqual([]);
  });
});

describe("getSsoSetupStatus()", () => {
  const acmeWithPin = (ssoProvider: string | null) => ({ id: "org_1", name: "Acme", ssoProvider });

  const statusOver = ({
    rows,
    organization,
  }: {
    rows: { providerId: string; accountId: string }[];
    organization: { id: string; name: string; ssoProvider: string | null } | null;
  }) => {
    const lookups: string[] = [];
    const service = FederatedAccountReadsService.create({
      accounts: createApiFixture<BetterAuthHooksRepository>({
        findFederatedAccountsForUser: async () => rows,
        tryFindOrganizationBySsoDomain: async ({ domain }: { domain: string }) => {
          lookups.push(domain);
          return organization;
        },
      }),
    });
    return { service, lookups };
  };

  const ask = (service: FederatedAccountReadsService, email = "andrei@acme.com") =>
    service.getSsoSetupStatus({ userId: "user-1", email });

  describe("given the user holds no sign-in matching the organization's single sign-on", () => {
    it("reports pending", async () => {
      const { service } = statusOver({ rows: [], organization: acmeWithPin("auth0") });

      await expect(ask(service)).resolves.toEqual({ pendingSsoSetup: true });
    });
  });

  describe("given the user already holds a matching sign-in (pin is a provider name)", () => {
    it("reports not pending", async () => {
      const { service } = statusOver({
        rows: [{ providerId: "auth0", accountId: "sub-1" }],
        organization: acmeWithPin("auth0"),
      });

      await expect(ask(service)).resolves.toEqual({ pendingSsoSetup: false });
    });
  });

  describe("given the pin is a providerAccountId prefix that the user's account id starts with", () => {
    it("reports not pending", async () => {
      const { service } = statusOver({
        rows: [{ providerId: "auth0", accountId: "waad|acme-conn|user-123" }],
        organization: acmeWithPin("waad|acme-conn"),
      });

      await expect(ask(service)).resolves.toEqual({ pendingSsoSetup: false });
    });
  });

  describe("given several accounts where only the second matches", () => {
    it("reports not pending with exactly one organization lookup", async () => {
      const { service, lookups } = statusOver({
        rows: [
          { providerId: "google", accountId: "g-1" },
          { providerId: "auth0", accountId: "sub-1" },
        ],
        organization: acmeWithPin("auth0"),
      });

      await expect(ask(service)).resolves.toEqual({ pendingSsoSetup: false });
      expect(lookups).toEqual(["acme.com"]);
    });
  });

  describe("given the organization has since dropped its single sign-on pin", () => {
    /** @scenario "A member is not asked to link a sign-in method their organization no longer requires" */
    it("reports not pending, since there is nothing left to link", async () => {
      const { service } = statusOver({ rows: [], organization: acmeWithPin(null) });

      await expect(ask(service)).resolves.toEqual({ pendingSsoSetup: false });
    });
  });

  describe("given no organization claims the user's domain any more", () => {
    it("reports not pending", async () => {
      const { service } = statusOver({ rows: [], organization: null });

      await expect(ask(service)).resolves.toEqual({ pendingSsoSetup: false });
    });
  });

  describe("given an address with no domain", () => {
    it("stays pending without reading accounts", async () => {
      const { service, lookups } = statusOver({ rows: [], organization: acmeWithPin("auth0") });

      await expect(ask(service, "no-domain")).resolves.toEqual({ pendingSsoSetup: true });
      expect(lookups).toEqual([]);
    });
  });
});
