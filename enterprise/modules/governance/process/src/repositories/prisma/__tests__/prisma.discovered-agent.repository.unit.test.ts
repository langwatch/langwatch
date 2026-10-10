// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Prisma } from "@langwatch/prisma-client/generated";
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
  existing: { displayText: string; metadata: unknown } | null;
}) {
  const createMany = vi.fn(async () => ({ count: createdCount }));
  const updateMany = vi.fn(async (_args: Prisma.DiscoveredAgentUpdateManyArgs) => ({ count: 1 }));
  const findFirst = vi.fn(async () => existing);
  const repository = PrismaDiscoveredAgentRepository.create(
    prismaDouble({ discoveredAgent: { createMany, updateMany, findFirst } }),
  );
  const updates = () => updateMany.mock.calls.map(([args]) => args);
  return { repository, createMany, updateMany, findFirst, updates };
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
