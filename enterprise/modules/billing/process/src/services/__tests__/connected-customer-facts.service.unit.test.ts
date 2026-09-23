/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  type ConnectedCustomerPeers,
  ConnectedCustomerFactsService,
} from "../connected-customer-facts.service.ts";

const ACME = "org-acme";
const AUGUST = Temporal.Instant.from("2026-08-01T00:00:00Z");
const SEPTEMBER = Temporal.Instant.from("2026-09-01T00:00:00Z");

type ProjectRow = Awaited<
  ReturnType<ConnectedCustomerPeers["organizations"]["listProjectsByOrganization"]>
>["data"][number];

function project(id: string): ProjectRow {
  const at = new Date("2026-01-01T00:00:00Z");
  return {
    id,
    name: id,
    slug: id,
    apiKey: "",
    lwqlKey: "",
    teamId: "team-acme",
    language: "python",
    framework: "openai",
    kind: "application",
    firstMessage: false,
    integrated: true,
    createdAt: at,
    updatedAt: at,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

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
    organizations: createApiFixture<ConnectedCustomerPeers["organizations"]>(
      peers.organizations ?? {},
    ),
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
        organizations: {
          listProjectsByOrganization: async () => ({
            data: [project("project-a"), project("project-b")],
            pagination: { page: 1, limit: 100, total: 2 },
          }),
        },
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
    it("reads the contract budget's spend in cents off the managed key", async () => {
      const service = facts({
        licensing: {
          getConnectedSeats: seatsWith("vk-managed"),
          getHostedUsage: async () => ({
            services: [],
            spend_available: true,
            read_at: "2026-09-01T00:00:00Z",
            contract: null,
            budgets: [
              {
                id: "budget-1",
                scope: "organization",
                window: "total",
                on_breach: "block" as const,
                cap_usd: 500,
                spent_usd: 123.456,
                remaining_usd: 376.544,
                period_started_at: "2026-01-01T00:00:00Z",
                is_contract: true,
              },
            ],
          }),
        },
      });

      await expect(service.getCommitDrawdown(ACME)).resolves.toEqual({
        kind: "read",
        usdCents: 123_46,
      });
    });

    /** @scenario "The billing contact receives a monthly usage statement" */
    it("answers unavailable rather than zero when no call has resolved a managed key", async () => {
      const service = facts({
        licensing: { getConnectedSeats: seatsWith(null), getContractTerms: terms },
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
