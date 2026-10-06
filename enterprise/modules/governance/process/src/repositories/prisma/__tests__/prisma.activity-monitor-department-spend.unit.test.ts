// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Spend by department across an organization's projects: combined personal and project spend,
 * and nothing from another organization. Spec: specs/ai-gateway/governance/departments.feature
 */
import type { QueryRequest, QueryResult } from "@langwatch/clickhouse-client";
import { ClickHouseQueryClient, TenantGuard } from "@langwatch/clickhouse-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { createActivityMonitorTestService } from "../../../__tests__/testing.ts";
import { memberGovernanceClickHouseResolver } from "../../clickhouse/clickhouse.governance-clickhouse.repositories.ts";

type SpendRow = {
  projectId: string;
  actor: string;
  spendUsdStr: string;
  requests: string;
  lastActivityMs: string;
};

const PROJECTS = [
  { id: "acme-personal", organizationId: "org-acme", departmentId: null },
  { id: "acme-marketing-site", organizationId: "org-acme", departmentId: "acme-marketing" },
  { id: "rival-personal", organizationId: "org-rival", departmentId: null },
  { id: "rival-site", organizationId: "org-rival", departmentId: "rival-engineering" },
];
const DEPARTMENTS = [
  { id: "acme-marketing", organizationId: "org-acme", name: "Marketing" },
  { id: "acme-engineering", organizationId: "org-acme", name: "Engineering" },
  { id: "rival-engineering", organizationId: "org-rival", name: "Engineering" },
];

const row = (projectId: string, actor: string, spend: string): SpendRow => ({
  projectId,
  actor,
  spendUsdStr: spend,
  requests: "1",
  lastActivityMs: "1000",
});

/** What ClickHouse holds, for every organization, answered only for the tenants a query names. */
const LEDGER: SpendRow[] = [
  row("acme-personal", "mia@acme.test", "10"),
  row("acme-personal", "eli@acme.test", "6"),
  row("acme-personal", "eve@acme.test", "2"),
  row("acme-marketing-site", "", "5"),
  row("rival-personal", "rob@rival.test", "900"),
  row("rival-site", "", "100"),
];

function departmentSpend() {
  const queries: QueryRequest[] = [];
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: {
      execute: async <Result>(request: QueryRequest): Promise<QueryResult<Result>> => {
        queries.push(request);
        const rows = LEDGER.filter((r) => request.tenantIds?.includes(r.projectId));
        return { rows: rows as Result[] };
      },
      insert: async () => undefined,
      command: async () => undefined,
    },
  });
  const orgOf = (args?: {
    where?: { team?: { organizationId?: unknown }; organizationId?: unknown };
  }) => args?.where?.team?.organizationId ?? args?.where?.organizationId;
  const service = createActivityMonitorTestService({
    prisma: prismaDouble({
      project: {
        findMany: vi.fn(async (args?: Parameters<typeof orgOf>[0]) =>
          PROJECTS.filter((p) => p.organizationId === orgOf(args)),
        ),
      },
      department: {
        findMany: vi.fn(async (args?: Parameters<typeof orgOf>[0]) =>
          DEPARTMENTS.filter((d) => d.organizationId === orgOf(args)),
        ),
      },
      organizationUser: {
        findMany: vi.fn(async () => [
          {
            departmentId: "acme-marketing",
            user: { email: "mia@acme.test", teamMemberships: [] },
          },
          {
            departmentId: null,
            user: {
              email: "eli@acme.test",
              teamMemberships: [
                { team: { departmentId: "acme-engineering" } },
                { team: { departmentId: "acme-engineering" } },
              ],
            },
          },
          {
            departmentId: "acme-engineering",
            user: { email: "eve@acme.test", teamMemberships: [] },
          },
        ]),
      },
    }),
    clickhouse: memberGovernanceClickHouseResolver(clickhouse),
  });
  return { service, queries };
}

describe("PrismaActivityMonitorRepository.spendByDepartment", () => {
  describe("when members of two departments spend personally and one department owns a project", () => {
    /** @scenario "Marketing-versus-engineering comparison reads from departments" */
    it("shows each department the sum of its members' personal spend and its own projects' spend, however many teams a member sits in", async () => {
      const { service } = departmentSpend();

      const rows = await service.spendByDepartment({ organizationId: "org-acme", windowDays: 30 });

      const totals = Object.fromEntries(rows.map((r) => [r.departmentName, r.spendUsd]));
      expect(totals).toEqual({ Marketing: "15", Engineering: "8" });
    });
  });

  describe("when another organization has spend under a department of the same name", () => {
    /** @scenario "Spend-by-department query stays tenant-isolated" */
    it("rolls up none of the other organization's spend and asks ClickHouse only for this organization's projects", async () => {
      const { service, queries } = departmentSpend();

      const rows = await service.spendByDepartment({ organizationId: "org-acme", windowDays: 30 });

      expect(rows.map((r) => r.spendUsd).toSorted()).toEqual(["15", "8"]);
      expect(queries.length).toBeGreaterThan(0);
      for (const query of queries) {
        expect(query.tenantIds).toEqual(["acme-personal", "acme-marketing-site"]);
        expect(query.sql).toMatch(/WHERE\s+TenantId IN \(/);
        expect(JSON.stringify(query)).not.toMatch(/rival/);
      }
    });
  });

  describe("when none of the traffic flows through a governance ingestion source", () => {
    /** @scenario "Spend by department aggregates across every project in the org" */
    it("totals the departments from the organization's own projects, personal and department-owned, without a governance project", async () => {
      const { service, queries } = departmentSpend();

      const rows = await service.spendByDepartment({ organizationId: "org-acme", windowDays: 30 });

      expect(queries.flatMap((query) => query.tenantIds ?? [])).toEqual(
        expect.arrayContaining(["acme-personal", "acme-marketing-site"]),
      );
      expect(rows.filter((r) => Number(r.spendUsd) > 0)).toHaveLength(2);
      expect(rows.reduce((sum, r) => sum + Number(r.spendUsd), 0)).toBe(23);
    });
  });
});
