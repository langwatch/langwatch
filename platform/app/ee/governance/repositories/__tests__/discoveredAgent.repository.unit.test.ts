// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What `recordAgentSighting` writes, and — more to the point — what it refuses
 * to write.
 *
 * Every Prisma call is a fake, so the only thing under test is the sequence of
 * writes the repository decides on: which WHERE clauses widen, what the merge
 * does with a field the provider stopped reporting, and what happens on the
 * pass where the row already exists.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature — "The list holds
 * the agents we registered and the agents we found". The rows this repository
 * writes are the found half.
 */
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { DiscoveredAgentRepository } from "../governanceIdentity.repository";

const organizationId = "org_agents_unit";
const provider = "databricks_genie";
const rawAgentId = "01f190cfd5c1";

interface Row {
  displayText: string;
  metadata: unknown;
}

interface Call {
  op: "createMany" | "updateMany" | "findFirst";
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/**
 * A `discoveredAgent` delegate that records every call and answers `createMany`
 * with the collision the caller is being tested against.
 *
 * `existing` is what a `findFirst` sees. Null stands for the row not being
 * there at all, which is the create path and must never reach a merge.
 */
const fakePrisma = (params: { createdCount: number; existing: Row | null }) => {
  const calls: Call[] = [];
  const prisma = {
    discoveredAgent: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        calls.push({ op: "createMany", data: data[0] });
        return { count: params.createdCount };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        calls.push({ op: "updateMany", where, data });
        return { count: 1 };
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        calls.push({ op: "findFirst", where });
        return params.existing;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
};

const updatesOf = (calls: Call[]) => calls.filter((c) => c.op === "updateMany");

describe("DiscoveredAgentRepository.recordAgentSighting", () => {
  describe("given the agent has never been listed before", () => {
    it("creates the row and stops", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 1,
        existing: null,
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        seenAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      expect(calls.map((c) => c.op)).toEqual(["createMany"]);
      expect(calls[0]?.data).toMatchObject({
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        firstSeenAt: new Date("2026-09-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-09-01T00:00:00.000Z"),
      });
    });

    it("asks the database to skip a duplicate rather than catching one", async () => {
      const { prisma, calls } = fakePrisma({ createdCount: 1, existing: null });
      let skipDuplicates: unknown;
      (
        prisma as unknown as {
          discoveredAgent: {
            createMany: (args: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).discoveredAgent.createMany = async (args) => {
        skipDuplicates = args.skipDuplicates;
        calls.push({ op: "createMany" });
        return { count: 1 };
      };

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: {},
        seenAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      expect(skipDuplicates).toBe(true);
    });
  });

  describe("given the unique key already holds a row", () => {
    it("widens the seen range instead of stamping it", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: {
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      const updates = updatesOf(calls);
      // Both date writes are conditional, and that IS the widen: a listing
      // replayed over a row already ahead of it matches neither WHERE.
      expect(updates[0]?.where).toMatchObject({
        organizationId,
        provider,
        rawAgentId,
        lastSeenAt: { lt: new Date("2026-09-05T00:00:00.000Z") },
      });
      expect(updates[0]?.data).toEqual({
        lastSeenAt: new Date("2026-09-05T00:00:00.000Z"),
      });
      expect(updates[1]?.where).toMatchObject({
        firstSeenAt: { gt: new Date("2026-09-05T00:00:00.000Z") },
      });
      expect(updates[1]?.data).toEqual({
        firstSeenAt: new Date("2026-09-05T00:00:00.000Z"),
      });
    });

    it("writes no third update when the listing repeats what is stored", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: {
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      // Two date widens and nothing else. The daily pass must not rewrite a
      // JSON column to the value it already holds.
      expect(updatesOf(calls)).toHaveLength(2);
    });

    it("keeps a metadata field the provider stopped reporting", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: {
          displayText: "Sales Copilot",
          metadata: {
            environmentUrl: "https://org1.crm.dynamics.com",
            modifiedOn: "2026-08-01T00:00:00Z",
          },
        },
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider: "copilot_studio_dataverse",
        rawAgentId: "bot-1",
        displayText: "Sales Copilot",
        // This listing carried no `modifiedOn` at all.
        metadata: { environmentUrl: "https://org1.crm.dynamics.com/renamed" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      const merge = updatesOf(calls).at(-1);
      expect(merge?.data).toEqual({
        metadata: {
          environmentUrl: "https://org1.crm.dynamics.com/renamed",
          modifiedOn: "2026-08-01T00:00:00Z",
        },
      });
    });

    it("leaves the stored name alone when the listing names none", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: {
          displayText: "Revenue Analyst",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "",
        metadata: { workspaceHost: "adb-2.azuredatabricks.net" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      const merge = updatesOf(calls).at(-1);
      expect(merge?.data).not.toHaveProperty("displayText");
      expect(merge?.data).toEqual({
        metadata: { workspaceHost: "adb-2.azuredatabricks.net" },
      });
    });

    it("upgrades the name when the listing carries a different one", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: {
          displayText: "01f190cfd5c1",
          metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        },
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      expect(updatesOf(calls).at(-1)?.data).toEqual({
        displayText: "Revenue Analyst",
      });
    });
  });

  describe("given the row vanished between the create attempt and the merge", () => {
    it("writes no merge at all", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: null,
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      // The two date widens still ran (they are no-op WHEREs against a row
      // that is gone); no merge was attempted on a row nobody read.
      expect(updatesOf(calls)).toHaveLength(2);
    });
  });

  describe("given every write names its organization", () => {
    it("scopes the merge read as well as the writes", async () => {
      const { prisma, calls } = fakePrisma({
        createdCount: 0,
        existing: { displayText: "x", metadata: {} },
      });

      await new DiscoveredAgentRepository().recordAgentSighting(prisma, {
        organizationId,
        provider,
        rawAgentId,
        displayText: "Revenue Analyst",
        metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
        seenAt: new Date("2026-09-05T00:00:00.000Z"),
      });

      // The multitenancy middleware rejects a clause with no organizationId,
      // so a read that forgot it would be a runtime failure rather than a
      // cross-tenant leak — but it would still be a broken write path.
      for (const call of calls) {
        if (call.op === "createMany") {
          expect(call.data).toMatchObject({ organizationId });
          continue;
        }
        expect(call.where).toMatchObject({ organizationId });
      }
    });
  });
});
