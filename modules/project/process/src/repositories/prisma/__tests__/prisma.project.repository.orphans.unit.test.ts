/**
 * @vitest-environment node
 * No foreign keys: a deleted team or organization leaves projects whose relation reads null.
 * Spec: modules/project/specs/project-service.feature, project-organization-paging.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { ProjectCreatedNoticeService } from "../../../services/project-created-notice.service.ts";
import { ProjectFactsBackfillService } from "../../../services/project-facts-backfill.service.ts";
import { PrismaProjectRepository } from "../prisma.project.repository.ts";

const created = new Date("2025-01-01T00:00:00.000Z");

const stored = (id: string, team: unknown) => ({
  id,
  createdAt: created,
  teamId: `team-of-${id}`,
  isPersonal: false,
  departmentId: null,
  presenceEnabled: true,
  archivedAt: null,
  team,
});

/** project-a has no team, project-b a team without its organization, project-c is whole. */
const ROWS = [
  stored("project-a", null),
  stored("project-b", { organizationId: "org-gone", organization: null }),
  stored("project-c", {
    organizationId: "org-1",
    organization: { members: [{ userId: "admin-1" }] },
  }),
];

function repositoryOver(rows: readonly ReturnType<typeof stored>[]) {
  type PageArgs = { where?: { id?: { gt: string } }; take?: number };
  const findMany = vi.fn(async (args: PageArgs) =>
    rows.filter((row) => !args.where?.id || row.id > args.where.id.gt).slice(0, args.take),
  );
  type ProjectDatabase = Parameters<typeof PrismaProjectRepository.create>[0]["prisma"];
  const prisma: ProjectDatabase = prismaDouble({
    project: { findMany: (args) => findMany((args ?? {}) as PageArgs) },
  });
  return PrismaProjectRepository.create({ prisma });
}

describe("PrismaProjectRepository over projects whose team or organization is gone", () => {
  describe("when the facts step reads a page", () => {
    /** @scenario "The project facts step skips a project whose team or organization is gone" */
    it("names both orphans and maps the whole project, with the last id as the cursor", async () => {
      const page = await repositoryOver(ROWS).listBackfillPage({ afterId: null, limit: 10 });

      expect(page.orphanIds).toEqual(["project-a", "project-b"]);
      expect(page.projects.map((project) => [project.id, project.organizationId])).toEqual([
        ["project-c", "org-1"],
      ]);
      expect(page.lastId).toBe("project-c");
    });
  });

  describe("when the project:record-created-facts step runs over them", () => {
    /** @scenario "The project facts step skips a project whose team or organization is gone" */
    it("completes instead of throwing, recording the whole project and counting the orphans", async () => {
      const { logger, lines } = createTestLogger();
      const createdBatches: Record<string, unknown>[][] = [];
      const lifecycle = ProjectCreatedNoticeService.create({
        logger,
        projects: { findWithOrgAdmin: async () => null, findWithTeam: async () => null },
      });
      const quiet = { send: async () => undefined };
      const batching = {
        send: async () => {
          throw new Error("the facts step sends a page as one batch");
        },
        sendBatch: async (data: Record<string, unknown>[]) => void createdBatches.push(data),
      };
      lifecycle.connect({
        recordProjectCreated: batching,
        recordProjectLegacyKeyRevoked: quiet,
        recordPresenceSettingChanged: batching,
        recordProjectMoved: quiet,
        recordProjectArchived: quiet,
        recordProjectDepartmentAssigned: batching,
        recordProjectTraceSharingDisabled: quiet,
        recordProjectAggregateRuleChanged: quiet,
        recordProjectRevived: quiet,
      });
      const step = ProjectFactsBackfillService.create({
        projects: repositoryOver(ROWS),
        lifecycle,
        logger,
      });

      const report = await step.recordExisting({
        dryRun: false,
        signal: new AbortController().signal,
        afterProjectId: null,
        countedBefore: {
          projects: 0,
          departmentAssignments: 0,
          presenceSettings: 0,
          skippedOrphans: 0,
          orphanProjectIds: [],
        },
        onPageDone: async () => undefined,
      });

      expect(report).toEqual({
        projects: 1,
        departmentAssignments: 1,
        presenceSettings: 1,
        skippedOrphans: 2,
        orphanProjectIds: ["project-a", "project-b"],
      });
      expect(createdBatches).toHaveLength(3);
      expect(lines.filter((line) => line.level === 40).map((line) => line.projectId)).toEqual([
        "project-a",
        "project-b",
      ]);
    });
  });

  describe("when a peer pages the projects with their organisation", () => {
    /** @scenario "A project whose team is gone is named as an orphan instead of paged with an organisation" */
    it("names the teamless project as an orphan and continues after it", async () => {
      const rows = [
        stored("project-a", { organizationId: "org-1" }),
        stored("project-b", null),
        stored("project-c", { organizationId: "org-1" }),
      ];

      const page = await repositoryOver(rows).listAllWithOrganization({ limit: 2 });

      expect(page).toEqual({
        projects: [{ id: "project-a", organizationId: "org-1" }],
        orphanIds: ["project-b"],
        next: "project-b",
      });
    });
  });
});
