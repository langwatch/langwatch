// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Spend by department spans an organisation's projects, so it asks trace for exactly that
 * project set; trace declares it as the tenant set. Spec: specs/ai-gateway/governance/departments.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { createActivityMonitorTestService } from "../../__tests__/testing.ts";

const PROJECTS = ["project-a", "project-b"];

describe("ActivityMonitorService.spendByDepartment", () => {
  describe("when the organisation has two projects", () => {
    /** @scenario "Spend by department reads the organization's projects as one declared tenant set" */
    it("asks trace for both projects as one read and nothing else", async () => {
      const asked: { projectIds: readonly string[]; valueKey: string }[] = [];
      const service = createActivityMonitorTestService({
        prisma: prismaDouble({
          project: {
            findMany: async () => PROJECTS.map((id) => ({ id, departmentId: null })),
          },
          department: { findMany: async () => [] },
          organizationUser: { findMany: async () => [] },
        }),
        clickhouse: {
          getClient: async () => {
            throw new Error("spend by department reads no governance table");
          },
        },
        traces: {
          findSpendByProjectAndValue: async ({ projectIds, valueKey }) => {
            asked.push({ projectIds, valueKey });
            return [];
          },
        },
      });

      await service.spendByDepartment({ organizationId: "org-a", windowDays: 7 });

      expect(asked).toEqual([{ projectIds: PROJECTS, valueKey: "langwatch.user_id" }]);
    });
  });
});
