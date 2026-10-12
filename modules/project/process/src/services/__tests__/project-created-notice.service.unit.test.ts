import type { Project, ProjectWithTeam } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * @see modules/project/specs/project-service.feature
 */
import { describe, expect, it, vi } from "vitest";

import type {
  RecordProjectCreatedCommandData,
  RecordProjectDepartmentAssignedCommandData,
  RecordProjectPresenceSettingChangedCommandData,
} from "../../eventing/project-lifecycle.events.ts";
import { ProjectCreatedNoticeService } from "../project-created-notice.service.ts";

const admins: Record<string, { organizationId: string; adminUserId: string | null }> = {
  "project-1": { organizationId: "org-1", adminUserId: "admin-1" },
  "project-2": { organizationId: "org-1", adminUserId: "admin-1" },
};

/** The two projects store different presence switches, so the backfill must carry each one. */
function projectWithTeam(input: { id: string; organizationId: string }): ProjectWithTeam {
  const at = new Date("2026-01-01T00:00:00.000Z");
  const project: Project = {
    id: input.id,
    name: input.id,
    slug: input.id,
    apiKey: "sk-lw-test",
    lwqlKey: "lwql-test",
    teamId: "team-1",
    language: "typescript",
    framework: "test",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: at,
    updatedAt: at,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: input.id === "project-1",
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
  return {
    ...project,
    team: {
      id: "team-1",
      name: "Team",
      slug: "team",
      organizationId: input.organizationId,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  };
}

function noticeOver() {
  const sent: RecordProjectCreatedCommandData[] = [];
  const presence: RecordProjectPresenceSettingChangedCommandData[] = [];
  const departments: RecordProjectDepartmentAssignedCommandData[] = [];
  const reads: number[] = [];
  const logger = { error: vi.fn() };
  const notice = ProjectCreatedNoticeService.create({
    logger,
    projects: {
      findIdsByOrganization: async () => Object.keys(admins),
      findWithTeam: async (id) => {
        const found = admins[id];
        return found ? projectWithTeam({ id, ...found }) : null;
      },
      findLiveWithTeamByIds: async (ids) => {
        reads.push(ids.length);
        return ids.flatMap((id) => {
          const found = admins[id];
          return found ? [projectWithTeam({ id, ...found })] : [];
        });
      },
      findWithOrgAdmin: async (id) => {
        const found = admins[id];
        return found
          ? { ...found, firstMessage: false, onboardingVariant: null, organizationCreatedAt: null }
          : null;
      },
    },
  });
  notice.connect({
    recordProjectCreated: {
      send: async (payload) => {
        sent.push(payload);
      },
    },
    recordProjectLegacyKeyRevoked: { send: async () => undefined },
    recordPresenceSettingChanged: {
      send: async (payload) => {
        presence.push(payload);
      },
    },
    recordProjectMoved: { send: async () => undefined },
    recordProjectArchived: { send: async () => undefined },
    recordProjectDepartmentAssigned: {
      send: async (payload) => {
        departments.push(payload);
      },
    },
    recordProjectTraceSharingDisabled: { send: async () => undefined },
    recordProjectAggregateRuleChanged: { send: async () => undefined },
    recordProjectRevived: { send: async () => undefined },
  });
  return { notice, sent, presence, departments, reads, logger };
}

describe("ProjectCreatedNoticeService", () => {
  /** @scenario "A failed project created fact logs the catch-up that recovers it" */
  it("names the backfill-project-created task when recording a new project fails", async () => {
    const { notice, logger } = noticeOver();
    notice.connect({
      recordProjectCreated: {
        send: async () => {
          throw new Error("event store down");
        },
      },
      recordProjectLegacyKeyRevoked: { send: async () => undefined },
      recordPresenceSettingChanged: { send: async () => undefined },
      recordProjectMoved: { send: async () => undefined },
      recordProjectArchived: { send: async () => undefined },
      recordProjectDepartmentAssigned: { send: async () => undefined },
      recordProjectTraceSharingDisabled: { send: async () => undefined },
      recordProjectAggregateRuleChanged: { send: async () => undefined },
      recordProjectRevived: { send: async () => undefined },
    });

    await notice.created({
      projectId: "project-1",
      organizationId: "org-1",
      createdByUserId: null,
      teamId: "team-1",
      isPersonal: false,
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
      expect.stringContaining("backfill-project-created"),
    );
  });

  /** @scenario "A new project's created event names the organization's admin" */
  it("records a new project with the organization's admin at that moment", async () => {
    const { notice, sent } = noticeOver();

    await notice.record({ projectId: "project-1", organizationId: "org-1" });

    expect(sent).toEqual([
      expect.objectContaining({ projectId: "project-1", adminUserId: "admin-1" }),
    ]);
    expect(sent[0]?.backfilled).toBeUndefined();
  });

  /** @scenario "Existing projects are recorded as created by the backfill, idempotently" */
  it("records every existing project marked backfilled, the same on every run", async () => {
    const { notice, sent } = noticeOver();

    await notice.recordExisting({ organizationId: "org-1" });
    const firstRun = sent.map(({ occurredAt: _at, ...rest }) => rest);
    sent.length = 0;
    await notice.recordExisting({ organizationId: "org-1" });

    expect(firstRun).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        organizationId: "org-1",
        adminUserId: "admin-1",
        backfilled: true,
      },
      {
        tenantId: "project-2",
        projectId: "project-2",
        organizationId: "org-1",
        adminUserId: "admin-1",
        backfilled: true,
      },
    ]);
    expect(sent.map(({ occurredAt: _at, ...rest }) => rest)).toEqual(firstRun);
  });

  /** @scenario "Existing projects' presence settings are recorded by the backfill, idempotently" */
  it("records each project's stored presence setting once per run, marked backfilled", async () => {
    const { notice, presence } = noticeOver();

    await notice.recordExistingPresenceSettings({ organizationId: "org-1" });
    const firstRun = presence.map(({ occurredAt: _at, ...rest }) => rest);
    presence.length = 0;
    await notice.recordExistingPresenceSettings({ organizationId: "org-1" });

    expect(firstRun).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        organizationId: "org-1",
        presenceEnabled: true,
        backfilled: true,
      },
      {
        tenantId: "project-2",
        projectId: "project-2",
        organizationId: "org-1",
        presenceEnabled: false,
        backfilled: true,
      },
    ]);
    expect(presence.map(({ occurredAt: _at, ...rest }) => rest)).toEqual(firstRun);
  });

  /** @scenario "Existing projects' departments and teams are recorded by the backfill, idempotently" */
  it("records each project's stored department and team once per run, marked backfilled", async () => {
    const { notice, departments } = noticeOver();

    await notice.recordExistingDepartmentAssignments({ organizationId: "org-1" });
    const firstRun = departments.map(({ occurredAt: _at, ...rest }) => rest);
    departments.length = 0;
    await notice.recordExistingDepartmentAssignments({ organizationId: "org-1" });

    expect(firstRun).toEqual(
      ["project-1", "project-2"].map((projectId) => ({
        tenantId: projectId,
        projectId,
        organizationId: "org-1",
        departmentId: null,
        teamId: "team-1",
        isPersonal: false,
        backfilled: true,
      })),
    );
    expect(departments.map(({ occurredAt: _at, ...rest }) => rest)).toEqual(firstRun);
  });

  describe("given an organization with a thousand projects", () => {
    function largeOrganization() {
      const ids = Array.from({ length: 1000 }, (_, index) => `big-${String(index).padStart(4, "0")}`);
      const reads: number[] = [];
      const adminReads: string[] = [];
      const presence: RecordProjectPresenceSettingChangedCommandData[] = [];
      const departments: RecordProjectDepartmentAssignedCommandData[] = [];
      const sent: RecordProjectCreatedCommandData[] = [];
      const notice = ProjectCreatedNoticeService.create({
        logger: { error: vi.fn() },
        projects: {
          findIdsByOrganization: async () => ids,
          findWithTeam: async () => {
            throw new Error("a backfill reads a page of projects, never one at a time");
          },
          findLiveWithTeamByIds: async (page) => {
            reads.push(page.length);
            return page.map((id) => projectWithTeam({ id, organizationId: "org-big" }));
          },
          findWithOrgAdmin: async (id) => {
            adminReads.push(id);
            return {
              organizationId: "org-big",
              adminUserId: "admin-big",
              firstMessage: false,
              onboardingVariant: null,
              organizationCreatedAt: null,
            };
          },
        },
      });
      const quiet = { send: async () => undefined };
      notice.connect({
        recordProjectCreated: { send: async (payload) => void sent.push(payload) },
        recordProjectLegacyKeyRevoked: quiet,
        recordPresenceSettingChanged: { send: async (payload) => void presence.push(payload) },
        recordProjectMoved: quiet,
        recordProjectArchived: quiet,
        recordProjectDepartmentAssigned: {
          send: async (payload) => void departments.push(payload),
        },
        recordProjectTraceSharingDisabled: quiet,
        recordProjectAggregateRuleChanged: quiet,
        recordProjectRevived: quiet,
      });
      return { notice, reads, adminReads, presence, departments, sent };
    }

    /** @scenario "A project fact backfill reads an organization's projects a page at a time" */
    it("reads presence settings in ten queries, not a thousand, and records every project", async () => {
      const { notice, reads, presence } = largeOrganization();

      expect(await notice.recordExistingPresenceSettings({ organizationId: "org-big" })).toBe(1000);

      expect(reads).toEqual(Array.from({ length: 10 }, () => 100));
      expect(new Set(presence.map((fact) => fact.projectId)).size).toBe(1000);
    });

    /** @scenario "A project fact backfill reads an organization's projects a page at a time" */
    it("reads departments in ten queries, not a thousand, and records every project", async () => {
      const { notice, reads, departments } = largeOrganization();

      expect(
        await notice.recordExistingDepartmentAssignments({ organizationId: "org-big" }),
      ).toBe(1000);

      expect(reads).toHaveLength(10);
      expect(departments.every((fact) => fact.backfilled === true)).toBe(true);
      expect(departments).toHaveLength(1000);
    });

    /** @scenario "A project fact backfill reads an organization's projects a page at a time" */
    it("reads the organization's admin once for every created fact", async () => {
      const { notice, adminReads, sent } = largeOrganization();

      expect(await notice.recordExisting({ organizationId: "org-big" })).toBe(1000);

      expect(adminReads).toHaveLength(1);
      expect(sent).toHaveLength(1000);
      expect(sent.every((fact) => fact.adminUserId === "admin-big")).toBe(true);
    });
  });
});
