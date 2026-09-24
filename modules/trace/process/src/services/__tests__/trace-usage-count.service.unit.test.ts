import { createApiFixture } from "@langwatch/api-fixture";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../repositories/memory/memory.trace-usage-count.repository.ts";
import { TraceUsageCountService } from "../trace-usage-count.service.ts";

const NOW = Temporal.Instant.from("2026-09-15T12:00:00Z");

function serviceOver(usageCount: MemoryTraceUsageCountRepository) {
  const projects = createApiFixture<ProjectApi>({
    listIdsByOrganization: async ({ organizationId }) =>
      organizationId === "org-1" ? ["project-a", "project-b"] : [],
  });

  return TraceUsageCountService.create({ projects, usageCount, now: () => NOW });
}

describe("TraceUsageCountService", () => {
  describe("given two projects with traces this month and last month", () => {
    /** @scenario "Each project's distinct traces this billing month are counted" */
    it("counts each project's distinct traces inside the UTC month", async () => {
      const usageCount = MemoryTraceUsageCountRepository.create();
      usageCount.record({
        tenantId: "project-a",
        traceId: "t1",
        createdAt: "2026-09-01 00:00:00.000",
      });
      usageCount.record({
        tenantId: "project-a",
        traceId: "t1",
        createdAt: "2026-09-02 00:00:00.000",
      });
      usageCount.record({
        tenantId: "project-a",
        traceId: "t2",
        createdAt: "2026-09-30 23:59:59.999",
      });
      usageCount.record({
        tenantId: "project-a",
        traceId: "t0",
        createdAt: "2026-08-31 23:59:59.999",
      });
      usageCount.record({
        tenantId: "project-b",
        traceId: "t3",
        createdAt: "2026-10-01 00:00:00.000",
      });

      const counts = await serviceOver(usageCount).countByProjects({
        organizationId: "org-1",
        projectIds: ["project-a", "project-b"],
      });

      expect(counts).toEqual([
        { projectId: "project-a", count: 2 },
        { projectId: "project-b", count: 0 },
      ]);
    });
  });

  describe("given a project of another organization", () => {
    /** @scenario "A project outside the organization is refused" */
    it("refuses before reading any count", async () => {
      const usageCount = MemoryTraceUsageCountRepository.create();
      usageCount.record({
        tenantId: "project-x",
        traceId: "t1",
        createdAt: "2026-09-02 00:00:00.000",
      });

      await expect(
        serviceOver(usageCount).countByProjects({
          organizationId: "org-1",
          projectIds: ["project-a", "project-x"],
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });
});
