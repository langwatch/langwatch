// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaDiscoveredAgentRepository } from "../prisma.discovered-agent.repository.ts";

const organizationId = "org_agents_unit";
const provider = "databricks_genie";
const rawAgentId = "01f190cfd5c1";
const SEPT_1 = new Date("2026-09-01T00:00:00.000Z");
const SEPT_5 = new Date("2026-09-05T00:00:00.000Z");

/** The three delegate calls a sighting makes, recorded in the order the repository made them. */
function recordingPrisma({
  createdCount,
  existing,
}: {
  createdCount: number;
  existing: { id?: string; displayText: string; metadata: unknown } | null;
}) {
  const createMany = vi.fn(async () => ({ count: createdCount }));
  const updateMany = vi.fn(async (_args: Prisma.DiscoveredAgentUpdateManyArgs) => ({ count: 1 }));
  const findFirst = vi.fn(async () => existing);
  const listingCreateMany = vi.fn(async (_args?: Prisma.DiscoveredAgentListingCreateManyArgs) => ({
    count: 0,
  }));
  const listingUpdateMany = vi.fn(async (_args: Prisma.DiscoveredAgentListingUpdateManyArgs) => ({
    count: 1,
  }));
  const transaction = vi.fn(async (work: (tx: PrismaClient) => Promise<unknown>) => work(client));
  const client: PrismaClient = prismaDouble({
    discoveredAgent: { createMany, updateMany, findFirst },
    discoveredAgentListing: { createMany: listingCreateMany, updateMany: listingUpdateMany },
    $transaction: transaction,
  });
  const repository = PrismaDiscoveredAgentRepository.create(client);
  const updates = () => updateMany.mock.calls.map(([args]) => args);
  const listingUpdates = () => listingUpdateMany.mock.calls.map(([args]) => args);
  return {
    repository,
    transaction,
    createMany,
    updateMany,
    findFirst,
    updates,
    listingCreateMany,
    listingUpdates,
  };
}

function sighting(
  overrides: { displayText?: string; metadata?: Record<string, string>; seenAt?: Date } = {},
) {
  return {
    organizationId,
    provider,
    rawAgentId,
    displayText: overrides.displayText ?? "Revenue Analyst",
    metadata: overrides.metadata ?? { workspaceHost: "adb-1.azuredatabricks.net" },
    seenAt: Temporal.Instant.fromEpochMilliseconds((overrides.seenAt ?? SEPT_5).getTime()),
  };
}

describe("PrismaDiscoveredAgentRepository.recordAgentSighting", () => {
  describe("given the agent has never been listed before", () => {
    it("creates the row and stops, asking the database to skip a duplicate", async () => {
      const world = recordingPrisma({ createdCount: 1, existing: null });

      await world.repository.recordAgentSighting(sighting({ seenAt: SEPT_1 }));

      expect(world.updateMany).not.toHaveBeenCalled();
      expect(world.findFirst).not.toHaveBeenCalled();
      expect(world.createMany).toHaveBeenCalledWith({
        data: [
          {
            organizationId,
            provider,
            rawAgentId,
            displayText: "Revenue Analyst",
            metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
            firstSeenAt: SEPT_1,
            lastSeenAt: SEPT_1,
          },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe("given the unique key already holds a row", () => {
    it("widens the seen range instead of stamping it", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: {
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await world.repository.recordAgentSighting(sighting());

      const [widenLast, widenFirst] = world.updates();
      expect(widenLast).toEqual({
        where: { organizationId, provider, rawAgentId, lastSeenAt: { lt: SEPT_5 } },
        data: { lastSeenAt: SEPT_5 },
      });
      expect(widenFirst).toEqual({
        where: { organizationId, provider, rawAgentId, firstSeenAt: { gt: SEPT_5 } },
        data: { firstSeenAt: SEPT_5 },
      });
    });

    it("writes no third update when the listing repeats what is stored", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: {
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await world.repository.recordAgentSighting(sighting());

      expect(world.updates()).toHaveLength(2);
    });

    it("keeps a metadata field the provider stopped reporting", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: {
          displayText: "Sales Copilot",
          metadata: {
            environmentUrl: "https://org1.crm.dynamics.com",
            modifiedOn: "2026-08-01T00:00:00Z",
          },
        },
      });

      await world.repository.recordAgentSighting({
        ...sighting({
          displayText: "Sales Copilot",
          metadata: { environmentUrl: "https://org1.crm.dynamics.com/renamed" },
        }),
        provider: "copilot_studio_dataverse",
        rawAgentId: "bot-1",
      });

      expect(world.updates().at(-1)?.data).toEqual({
        metadata: {
          environmentUrl: "https://org1.crm.dynamics.com/renamed",
          modifiedOn: "2026-08-01T00:00:00Z",
        },
      });
    });

    it("leaves the stored name alone when the listing names none", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: {
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await world.repository.recordAgentSighting(
        sighting({ displayText: "", metadata: { workspaceHost: "adb-2.azuredatabricks.net" } }),
      );

      expect(world.updates().at(-1)?.data).toEqual({
        metadata: { workspaceHost: "adb-2.azuredatabricks.net" },
      });
    });

    it("upgrades the name when the listing carries a different one", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: {
          displayText: "01f190cfd5c1",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await world.repository.recordAgentSighting(sighting());

      expect(world.updates().at(-1)?.data).toEqual({ displayText: "Revenue Analyst" });
    });
  });

  describe("given the row vanished between the create attempt and the merge", () => {
    it("writes no merge at all", async () => {
      const world = recordingPrisma({ createdCount: 0, existing: null });

      await world.repository.recordAgentSighting(sighting());

      expect(world.updates()).toHaveLength(2);
    });
  });

  describe("given every write names its organization", () => {
    it("scopes the merge read as well as the writes", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: { displayText: "x", metadata: {} },
      });

      await world.repository.recordAgentSighting(sighting());

      expect(world.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId }) }),
      );
      for (const update of world.updates()) expect(update?.where).toMatchObject({ organizationId });
    });
  });
});

describe("PrismaDiscoveredAgentRepository source presence", () => {
  describe("given a source lists an agent it had marked gone", () => {
    it("moves that source's presence forward and clears its gone mark, leaving the agent row's merge alone", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: {
          id: "agent_1",
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await world.repository.recordAgentSighting({ ...sighting(), ingestionSourceId: "source_1" });

      expect(world.updates()).toHaveLength(2);
      expect(world.transaction).toHaveBeenCalledOnce();
      expect(world.listingCreateMany).toHaveBeenCalledWith({
        data: [
          {
            organizationId,
            ingestionSourceId: "source_1",
            discoveredAgentId: "agent_1",
            lastListedAt: SEPT_5,
          },
        ],
        skipDuplicates: true,
      });
      expect(world.listingUpdates()).toEqual([
        {
          where: {
            organizationId,
            ingestionSourceId: "source_1",
            discoveredAgentId: "agent_1",
            lastListedAt: { lte: SEPT_5 },
            OR: [{ goneAt: null }, { goneAt: { lte: SEPT_5 } }],
          },
          data: { lastListedAt: SEPT_5, goneAt: null },
        },
      ]);
    });
  });

  describe("given a sighting with no source", () => {
    it("records no presence", async () => {
      const world = recordingPrisma({
        createdCount: 0,
        existing: { id: "agent_1", displayText: "Revenue Analyst", metadata: {} },
      });

      await world.repository.recordAgentSighting(sighting());

      expect(world.listingCreateMany).not.toHaveBeenCalled();
    });
  });

  describe("when a listing finishes", () => {
    it("marks only that source's presence it did not see, at the listing's instant", async () => {
      const world = recordingPrisma({ createdCount: 0, existing: null });

      await world.repository.markUnlistedGone({
        organizationId,
        ingestionSourceId: "source_1",
        listedAt: Temporal.Instant.fromEpochMilliseconds(SEPT_5.getTime()),
      });

      expect(world.listingUpdates()).toEqual([
        {
          where: {
            organizationId,
            ingestionSourceId: "source_1",
            lastListedAt: { lt: SEPT_5 },
            OR: [{ goneAt: null }, { goneAt: { lt: SEPT_5 } }],
          },
          data: { goneAt: SEPT_5 },
        },
      ]);
    });
  });

  describe("when the registry reads the organisation's agents", () => {
    it("leaves out only the agents every source that listed them marked gone", async () => {
      const row = (id: string) => ({
        id,
        provider,
        rawAgentId: id,
        displayText: id,
        metadata: {},
        firstSeenAt: SEPT_1,
        lastSeenAt: SEPT_1,
      });
      const repository = PrismaDiscoveredAgentRepository.create(
        prismaDouble({
          discoveredAgent: {
            findMany: vi.fn(async () => [row("both"), row("one_left"), row("gone"), row("old")]),
          },
          discoveredAgentListing: {
            findMany: vi.fn(async () => [
              { discoveredAgentId: "both", goneAt: null },
              { discoveredAgentId: "one_left", goneAt: SEPT_5 },
              { discoveredAgentId: "one_left", goneAt: null },
              { discoveredAgentId: "gone", goneAt: SEPT_5 },
            ]),
          },
        }),
      );

      const rows = await repository.findForRegistry({ organizationId });

      expect(rows.map((agent) => agent.id)).toEqual(["both", "one_left", "old"]);
    });
  });
});
