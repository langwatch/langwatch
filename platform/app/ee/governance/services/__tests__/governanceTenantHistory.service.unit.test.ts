// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  recordGovernanceTenantUse,
  resolveGovOrganizationId,
  resolveGovTenantIds,
} from "../governanceTenantHistory.service";

/**
 * A Prisma stand-in that behaves like the unique index does: `updateMany`
 * reports how many rows it matched, and `createMany` is what runs when it
 * matched none.
 */
function prismaWithHistory(
  rows: { organizationId: string; tenantId: string }[],
) {
  const stored = [...rows];
  return {
    stored,
    client: {
      governanceTenantHistory: {
        updateMany: vi.fn(async ({ where }) => ({
          count: stored.filter(
            (row) =>
              row.organizationId === where.organizationId &&
              row.tenantId === where.tenantId,
          ).length,
        })),
        createMany: vi.fn(async ({ data }) => {
          for (const row of data) {
            stored.push({
              organizationId: row.organizationId,
              tenantId: row.tenantId,
            });
          }
          return { count: data.length };
        }),
        findMany: vi.fn(async ({ where }) =>
          stored.filter(
            (row) => !where || row.organizationId === where.organizationId,
          ),
        ),
        findFirst: vi.fn(
          async ({ where }) =>
            stored.find((row) => row.tenantId === where.tenantId) ?? null,
        ),
      },
    } as unknown as PrismaClient,
  };
}

describe("given an organization's governance area", () => {
  describe("when it is resolved for the first time", () => {
    /** @scenario "The first time an organization's governance area is used it is recorded" */
    it("records it against the organization", async () => {
      const { client, stored } = prismaWithHistory([]);

      await recordGovernanceTenantUse({
        prisma: client,
        organizationId: "org_a",
        tenantId: "project_gov",
      });

      expect(stored).toEqual([
        { organizationId: "org_a", tenantId: "project_gov" },
      ]);
    });
  });

  describe("when it is resolved again", () => {
    /** @scenario "Resolving the same area again does not record it twice" */
    it("moves the last-used time without adding a second row", async () => {
      const { client, stored } = prismaWithHistory([
        { organizationId: "org_a", tenantId: "project_gov" },
      ]);

      await recordGovernanceTenantUse({
        prisma: client,
        organizationId: "org_a",
        tenantId: "project_gov",
      });

      expect(stored).toHaveLength(1);
      expect(client.governanceTenantHistory.updateMany).toHaveBeenCalled();
      expect(client.governanceTenantHistory.createMany).not.toHaveBeenCalled();
    });

    it("does not read before writing, so the common path is one statement", async () => {
      const { client } = prismaWithHistory([
        { organizationId: "org_a", tenantId: "project_gov" },
      ]);

      await recordGovernanceTenantUse({
        prisma: client,
        organizationId: "org_a",
        tenantId: "project_gov",
      });

      expect(client.governanceTenantHistory.findFirst).not.toHaveBeenCalled();
      expect(client.governanceTenantHistory.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the database refuses the write", () => {
    it("does not fail the request that happened to be first through the door", async () => {
      const client = {
        governanceTenantHistory: {
          updateMany: vi
            .fn()
            .mockRejectedValue(new Error("connection refused")),
        },
      } as unknown as PrismaClient;

      await expect(
        recordGovernanceTenantUse({
          prisma: client,
          organizationId: "org_a",
          tenantId: "project_gov",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given an organization that has used more than one governance area", () => {
  describe("when the whole history is asked for", () => {
    it("returns every area, not only the current one", async () => {
      const { client } = prismaWithHistory([
        { organizationId: "org_a", tenantId: "project_gov_old" },
        { organizationId: "org_a", tenantId: "project_gov_new" },
        { organizationId: "org_b", tenantId: "project_gov_other" },
      ]);

      const tenantIds = await resolveGovTenantIds({
        prisma: client,
        organizationId: "org_a",
      });

      expect(tenantIds).toEqual(["project_gov_old", "project_gov_new"]);
    });
  });

  describe("when a caller holds an area id and needs the organization", () => {
    it("translates a retired area as readily as the current one", async () => {
      const { client } = prismaWithHistory([
        { organizationId: "org_a", tenantId: "project_gov_old" },
      ]);

      await expect(
        resolveGovOrganizationId({
          prisma: client,
          tenantId: "project_gov_old",
        }),
      ).resolves.toBe("org_a");
    });

    it("answers null for an area nobody recorded", async () => {
      const { client } = prismaWithHistory([]);

      await expect(
        resolveGovOrganizationId({ prisma: client, tenantId: "project_x" }),
      ).resolves.toBeNull();
    });
  });
});
