import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  type ConnectedCustomerPeers,
  ConnectedCustomerFactsService,
} from "../../features/connected-billing/services/connected-customer-facts.service.ts";

const ACME = "org-acme";
const AUGUST = Temporal.Instant.from("2026-08-01T00:00:00Z");
const SEPTEMBER = Temporal.Instant.from("2026-09-01T00:00:00Z");

const seatsWith = (managedVirtualKeyId: string | null) => async () => ({
  licensed: 10,
  reported: 7,
  lastSyncAt: null,
  managedVirtualKeyId,
});

const terms = async () => ({
  commitUsdCents: 500_00,
  maximumUsdCents: 800_00,
  overageEnabled: true,
  services: [],
  termEndsAt: null,
  termStartsAt: null,
});

function facts(
  peers: Partial<{ [K in keyof ConnectedCustomerPeers]: Partial<ConnectedCustomerPeers[K]> }>,
) {
  return ConnectedCustomerFactsService.create({
    licensing: createApiFixture<ConnectedCustomerPeers["licensing"]>(peers.licensing ?? {}),
    gateway: createApiFixture<ConnectedCustomerPeers["gateway"]>(peers.gateway ?? {}),
    contractBudgets: createApiFixture<ConnectedCustomerPeers["contractBudgets"]>(
      peers.contractBudgets ?? {},
    ),
    organizations: createApiFixture<ConnectedCustomerPeers["organizations"]>(
      peers.organizations ?? {},
    ),
    projects: createApiFixture<ConnectedCustomerPeers["projects"]>(peers.projects ?? {}),
  });
}

describe("ConnectedCustomerFactsService", () => {
  describe("when a month's spend is summed", () => {
    /** @scenario "The billing contact receives a monthly usage statement" */
    it("sums the month across every project of the customer, in cents", async () => {
      const asked: unknown[] = [];
      const service = facts({
        gateway: {
          isSpendSourceAvailable: () => true,
          sumSpendNanoUsdByRequestType: async (input) => {
            asked.push(input);
            return 12_345_000_000;
          },
        },
        projects: { findProjectIds: async () => ["project-a", "project-b"] },
      });

      await expect(
        service.findSpendByService({ organizationId: ACME, from: AUGUST, until: SEPTEMBER }),
      ).resolves.toEqual([{ service: "instant_evals", usdCents: 12_35 }]);
      expect(asked).toEqual([
        {
          tenantIds: ["project-a", "project-b"],
          requestType: INSTANT_EVAL_REQUEST_TYPE,
          fromMs: AUGUST.epochMilliseconds,
          toMs: SEPTEMBER.epochMilliseconds,
        },
      ]);
    });

    it("reports nothing rather than zero when the ledger is not available", async () => {
      const service = facts({ gateway: { isSpendSourceAvailable: () => false } });

      await expect(
        service.findSpendByService({ organizationId: ACME, from: AUGUST, until: SEPTEMBER }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the commit drawn down is read", () => {
    /** @scenario "The commit drawdown reads the contract budget without calling the hosted route" */
    it("sums the contract budget's bucket since its window opened, in cents", async () => {
      const asked: unknown[] = [];
      const service = facts({
        contractBudgets: {
          findContractBudget: async () => [
            {
              id: "budget-1",
              scopeId: ACME,
              providerKey: null,
              limitUsdCents: 500_00,
              currentPeriodStartedAt: AUGUST,
            },
          ],
        },
        gateway: {
          isSpendSourceAvailable: () => true,
          sumBudgetSpendNanoUsd: async (input) => {
            asked.push(input);
            return 123_456_000_000;
          },
        },
        projects: { findProjectIds: async () => ["project-a"] },
      });

      await expect(service.getCommitDrawdown(ACME)).resolves.toEqual({
        kind: "read",
        usdCents: 123_46,
      });
      expect(asked).toEqual([
        {
          tenantIds: ["project-a"],
          budgetId: "budget-1",
          bucketScopeId: ACME,
          fromMs: AUGUST.epochMilliseconds,
        },
      ]);
    });

    it("answers unavailable rather than zero when the budget ledger cannot be read", async () => {
      const service = facts({
        contractBudgets: {
          findContractBudget: async () => [
            {
              id: "budget-1",
              scopeId: ACME,
              providerKey: null,
              limitUsdCents: 500_00,
              currentPeriodStartedAt: AUGUST,
            },
          ],
        },
        gateway: {
          isSpendSourceAvailable: () => true,
          sumBudgetSpendNanoUsd: async () => {
            throw new Error("clickhouse down");
          },
        },
        projects: { findProjectIds: async () => ["project-a"] },
      });

      await expect(service.getCommitDrawdown(ACME)).resolves.toEqual({ kind: "unavailable" });
    });

    /** @scenario "The commit drawdown is unavailable before a contract budget exists" */
    it("answers unavailable rather than zero when no contract budget is synced", async () => {
      const service = facts({
        contractBudgets: { findContractBudget: async () => [] },
        licensing: { getContractTerms: terms },
      });

      await expect(service.getCommitDrawdown(ACME)).resolves.toEqual({ kind: "unavailable" });
    });
  });

  describe("when the seats are read", () => {
    it("reads the licensed and reported seats of the license that runs longest", async () => {
      const service = facts({ licensing: { getConnectedSeats: seatsWith(null) } });

      await expect(service.getSeats(ACME)).resolves.toEqual({ licensed: 10, reported: 7 });
    });
  });
});
