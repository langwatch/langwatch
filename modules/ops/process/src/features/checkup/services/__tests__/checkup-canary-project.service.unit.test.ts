/** Spec: modules/ops/specs/checkup-canary-project.feature */
import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { CheckupCanaryProjectService } from "../checkup-canary-project.service.ts";

/** One install's organizations and internal projects, as the two owners would keep them. */
function install() {
  const systemOrganizations: string[] = [];
  const projects: InternalProject[] = [];
  const service = CheckupCanaryProjectService.create({
    organizations: {
      ensureSystemOrganization: async () => {
        if (systemOrganizations.length === 0) systemOrganizations.push("org-system");
        return { id: systemOrganizations[0]! };
      },
    },
    projects: {
      findInternalIds: async ({ kind }) =>
        projects.filter((project) => project.kind === kind).map(({ id }) => id),
      ensureInternal: async ({ organizationId, kind }: InternalProjectQuery) => {
        const project: InternalProject = {
          id: `project-${projects.length + 1}`,
          name: "Checkup canary (internal)",
          slug: `checkup-${organizationId}`,
          teamId: "team-system",
          kind,
          archivedAtMs: null,
          traceSharingEnabled: false,
        };
        projects.push(project);
        return project;
      },
    },
  });
  return { service, systemOrganizations, projects };
}

describe("CheckupCanaryProjectService.ensure", () => {
  describe("when the checkup's migration step runs twice", () => {
    /** @scenario "The hidden organisation and project are created once by a migration step" */
    it("creates one system organization holding one checkup project", async () => {
      const { service, systemOrganizations, projects } = install();

      const first = await service.ensure({ dryRun: false });
      const second = await service.ensure({ dryRun: false });

      expect(first).toEqual({ projectId: "project-1", created: true });
      expect(second).toEqual({ projectId: "project-1", created: false });
      expect(systemOrganizations).toEqual(["org-system"]);
      expect(projects.map(({ kind, slug }) => ({ kind, slug }))).toEqual([
        { kind: "internal_checkup", slug: "checkup-org-system" },
      ]);
    });
  });

  describe("when it runs dry", () => {
    it("creates nothing and says it would", async () => {
      const { service, systemOrganizations, projects } = install();

      await expect(service.ensure({ dryRun: true })).resolves.toEqual({ wouldCreate: true });
      expect(systemOrganizations).toEqual([]);
      expect(projects).toEqual([]);
    });
  });
});
