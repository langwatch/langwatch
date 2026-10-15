import { describe, expect, it } from "vitest";

import { ProjectHasNoOrganizationError } from "../../../../repositories/tenant-source.repository.ts";
import { SystemMigrationPassCohortService } from "../system-migration-pass-cohort.service.ts";

describe("a project cohort admitted through its owning organization", () => {
  const owners: Record<string, string> = { project_ok: "org_1" };
  const lookups: string[] = [];
  const projectTenants = {
    findOrganizationIds: async ({ projectIds }: { projectIds: readonly string[] }) =>
      projectIds.flatMap((projectId) =>
        owners[projectId] ? [{ projectId, organizationId: owners[projectId] }] : [],
      ),
    getOrganizationId: async (projectId: string) => {
      lookups.push(projectId);
      const organizationId = owners[projectId];
      if (!organizationId) throw new ProjectHasNoOrganizationError(projectId);
      return organizationId;
    },
  };
  const cohort = SystemMigrationPassCohortService.create({
    repositories: { projectTenants } as never,
  }).throughOwningOrganization({
    organizationCohort: ({ tenantId }) => tenantId === "org_1",
  });

  it("admits a project whose organization is enrolled", async () => {
    await expect(cohort({ tenantId: "project_ok", migrationName: "m" })).resolves.toBe(true);
  });

  it("skips an orphan project instead of failing the pass", async () => {
    await cohort.prepare?.({ tenantIds: ["project_orphan"] });
    await expect(cohort({ tenantId: "project_orphan", migrationName: "m" })).resolves.toBe(false);
  });

  it("skips an orphan that was never prepared", async () => {
    await expect(cohort({ tenantId: "project_other_orphan", migrationName: "m" })).resolves.toBe(
      false,
    );
  });

  it("reads an orphan once per pass, however many migrations ask", async () => {
    await cohort({ tenantId: "project_repeat_orphan", migrationName: "m1" });
    await cohort({ tenantId: "project_repeat_orphan", migrationName: "m2" });
    expect(lookups.filter((id) => id === "project_repeat_orphan")).toHaveLength(1);
  });
});
