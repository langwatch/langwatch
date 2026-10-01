// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Spend by department spans an organisation's projects, so it declares that tenant set and runs
 * through the real tenant guard here. Spec: specs/ai-gateway/governance/departments.feature
 */
import type { QueryRequest, QueryResult } from "@langwatch/clickhouse-client";
import { ClickHouseQueryClient, TenantGuard } from "@langwatch/clickhouse-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { memberGovernanceClickHouseResolver } from "../../clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import { PrismaActivityMonitorRepository } from "../prisma.ingestion-source-activity.repository.ts";

const PROJECTS = ["project-a", "project-b"];

function guardedRepository() {
  const executed: QueryRequest[] = [];
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: {
      execute: async <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
        executed.push(request);
        return { rows: [] };
      },
      insert: async () => undefined,
      command: async () => undefined,
    },
  });
  const repository = PrismaActivityMonitorRepository.create({
    prisma: prismaDouble({
      project: {
        findMany: async () => PROJECTS.map((id) => ({ id, departmentId: null })),
      },
      department: { findMany: async () => [] },
      organizationUser: { findMany: async () => [] },
    }),
    clickhouse: memberGovernanceClickHouseResolver(clickhouse),
  });
  return { repository, executed };
}

describe("PrismaActivityMonitorRepository.spendByDepartment", () => {
  describe("when the organisation has two projects", () => {
    /** @scenario "Spend by department reads the organization's projects as one declared tenant set" */
    it("declares both projects as its tenant set and passes the real tenant guard", async () => {
      const { repository, executed } = guardedRepository();

      await repository.spendByDepartment({ organizationId: "org-a", windowDays: 7 });

      expect(executed).toHaveLength(1);
      const request = executed[0];
      expect(request?.tenantIds).toEqual(PROJECTS);
      expect(request?.tenantId).toBe("project-a");
      expect(request?.params).toMatchObject({ tenant0: "project-a", tenant1: "project-b" });
      expect(request?.sql).toContain("TenantId IN ({tenant0:String}, {tenant1:String})");
      expect(request?.settings?.max_execution_time).toBe(45);
    });
  });
});
