// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The bill-credential guard, exercised through the real edit path.
 *
 * The guard's own unit tests prove what it refuses; these prove the SERVICE
 * asks it. `updateSource` carries the stored encrypted envelope across when a
 * client resends no secrets, which is exactly the shape that used to slip a
 * new subscription claim past the credential check — the envelope was never
 * proven to hold a billing pair, and the state "subscription named, bill
 * unreadable forever" became storable one API call away. A test that binds
 * the refusal to `updateSource` fails if the guard call is ever dropped from
 * the service, which the guard's own tests cannot see.
 *
 * Spec: specs/governance/azure-billing-identity.feature
 * Decision: ADR-128 §21.2 (v3.4).
 */

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

const ORG = "org_1";
const SOURCE_ID = "src_1";
const SUBSCRIPTION = "00000000-0000-4000-8000-000000000001";

const rowWith = (over: Record<string, unknown> = {}) => ({
  id: SOURCE_ID,
  organizationId: ORG,
  teamId: null,
  sourceType: "copilot_studio_dataverse",
  name: "Copilot Studio",
  description: null,
  ingestSecretHash: "",
  parserConfig: {
    adapter: "copilot_studio_dataverse",
    environmentUrl: "https://orgacme01.crm4.dynamics.com",
    // The stored form: encrypted at rest, unreadable to the guard.
    credentials: "enc:v1:abcdef",
  },
  pollerCursor: null,
  errorCount: 0,
  pullSchedule: null,
  status: "awaiting_first_event",
  traceProjectId: null,
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  createdById: null,
  ...over,
});

const fakePrisma = (row: ReturnType<typeof rowWith>) => {
  const update = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(rowWith(data)),
    );
  const client = {
    ingestionSource: {
      findUnique: vi.fn().mockResolvedValue(row),
      // The bill-ownership listing. The row itself is the only source, and it
      // is excluded from its own check by id.
      findMany: vi.fn().mockResolvedValue([row]),
      update,
    },
  };
  return { client: client as unknown as PrismaClient, update };
};

describe("updateSource, when the edit touches the Azure bill claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a source whose stored config claims no subscription", () => {
    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it("refuses an edit that adds the claim without re-entering credentials", async () => {
      const { client, update } = fakePrisma(rowWith());

      await expect(
        IngestionSourceService.create(client).updateSource({
          id: SOURCE_ID,
          organizationId: ORG,
          parserConfig: {
            environmentUrl: "https://orgacme01.crm4.dynamics.com",
            azureSubscriptionId: SUBSCRIPTION,
          },
        }),
      ).rejects.toThrow(/re-enter the credentials/i);
      expect(update).not.toHaveBeenCalled();
    });

    it("saves the same edit when the credentials arrive with the billing pair", async () => {
      const { client, update } = fakePrisma(rowWith());

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: {
          environmentUrl: "https://orgacme01.crm4.dynamics.com",
          azureSubscriptionId: SUBSCRIPTION,
          credentials: {
            tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
            clientId: "bot-client-id",
            clientSecret: "bot-client-secret",
            billingClientId: "billing-client-id",
            billingClientSecret: "billing-client-secret",
          },
        },
      });

      expect(update).toHaveBeenCalledOnce();
    });
  });

  describe("given a source whose stored config already claims the subscription", () => {
    it("lets a rename through without resending secrets", async () => {
      // The pair inside the envelope was proven when the claim was first
      // saved. An edit that carries both across must stay an ordinary edit.
      const { client, update } = fakePrisma(
        rowWith({
          parserConfig: {
            adapter: "copilot_studio_dataverse",
            environmentUrl: "https://orgacme01.crm4.dynamics.com",
            azureSubscriptionId: SUBSCRIPTION,
            credentials: "enc:v1:abcdef",
          },
        }),
      );

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        name: "Copilot Studio, renamed",
        parserConfig: {
          environmentUrl: "https://orgacme01.crm4.dynamics.com",
          azureSubscriptionId: SUBSCRIPTION,
        },
      });

      expect(update).toHaveBeenCalledOnce();
    });
  });
});

describe("updateSource, when the edit changes which subscription's bill is read", () => {
  const OTHER_SUBSCRIPTION = "00000000-0000-4000-8000-000000000002";
  /** A cursor as the puller stores it after a priced cost read. */
  const PRICED_CURSOR = JSON.stringify({
    costPricedThroughDay: "2026-08-30",
    costHeldSinceMs: null,
    costReadAtMs: 1756500000000,
  });
  const claimingRow = (over: Record<string, unknown> = {}) =>
    rowWith({
      parserConfig: {
        adapter: "copilot_studio_dataverse",
        environmentUrl: "https://orgacme01.crm4.dynamics.com",
        azureSubscriptionId: SUBSCRIPTION,
        credentials: "enc:v1:abcdef",
      },
      ...over,
    });

  describe("given the bill has already been read", () => {
    /** @scenario "A source that has read one bill cannot be pointed at another" */
    it("refuses to swap the subscription behind the sealed envelope", async () => {
      const { client, update } = fakePrisma(
        claimingRow({ pollerCursor: PRICED_CURSOR }),
      );

      await expect(
        IngestionSourceService.create(client).updateSource({
          id: SOURCE_ID,
          organizationId: ORG,
          parserConfig: {
            environmentUrl: "https://orgacme01.crm4.dynamics.com",
            azureSubscriptionId: OTHER_SUBSCRIPTION,
          },
        }),
      ).rejects.toThrow(/archive this source and create a new one/i);
      expect(update).not.toHaveBeenCalled();
    });

    /** @scenario "A source that has read one bill cannot be pointed at another" */
    it("still lets the claim be dropped, because stopping mixes nothing", async () => {
      const { client, update } = fakePrisma(
        claimingRow({ pollerCursor: PRICED_CURSOR }),
      );

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: {
          environmentUrl: "https://orgacme01.crm4.dynamics.com",
        },
      });

      expect(update).toHaveBeenCalledOnce();
    });
  });

  describe("given the bill has never been read", () => {
    /** @scenario "A source that has read one bill cannot be pointed at another" */
    it("lets the subscription swap through, as before", async () => {
      // No cost read has happened, so there is no old bill's memory to mix
      // with the new one: no cursor to resume from, no rows filed under this
      // source. The convenience the swap exists for — one registered app
      // holding the reader role across several subscriptions — is untouched.
      const { client, update } = fakePrisma(
        claimingRow({ pollerCursor: null }),
      );

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: {
          environmentUrl: "https://orgacme01.crm4.dynamics.com",
          azureSubscriptionId: OTHER_SUBSCRIPTION,
        },
      });

      expect(update).toHaveBeenCalledOnce();
    });
  });

  describe("given the claim was dropped earlier but the bill's memory remains", () => {
    /** @scenario "A source that has read one bill cannot be pointed at another" */
    it("refuses to claim a subscription in two steps, even with fresh credentials", async () => {
      // Drop the claim in one edit, add a different one in the next: without
      // this refusal the two-step lands exactly where the direct swap was
      // refused — old cursor, old rows, new claim. Held state counts as
      // memory too: a held window carried across says "this bill's read
      // failed" about a bill it never tried.
      const { client, update } = fakePrisma(
        rowWith({
          pollerCursor: JSON.stringify({
            costPricedThroughDay: null,
            costHeldSinceMs: 1756500000000,
            costReadAtMs: null,
          }),
        }),
      );

      await expect(
        IngestionSourceService.create(client).updateSource({
          id: SOURCE_ID,
          organizationId: ORG,
          parserConfig: {
            environmentUrl: "https://orgacme01.crm4.dynamics.com",
            azureSubscriptionId: OTHER_SUBSCRIPTION,
            credentials: {
              tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
              clientId: "bot-client-id",
              clientSecret: "bot-client-secret",
              billingClientId: "billing-client-id",
              billingClientSecret: "billing-client-secret",
            },
          },
        }),
      ).rejects.toThrow(/archive this source and create a new one/i);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
