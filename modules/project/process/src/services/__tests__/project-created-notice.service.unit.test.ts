import type { Project, ProjectWithTeam } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * @see modules/project/specs/project-service.feature
 */
import { describe, expect, it, vi } from "vitest";

import type {
  RecordProjectCreatedCommandData,
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
  const notice = ProjectCreatedNoticeService.create({
    logger: { error: vi.fn() },
    projects: {
      findIdsByOrganization: async () => Object.keys(admins),
      findWithTeam: async (id) => {
        const found = admins[id];
        return found ? projectWithTeam({ id, ...found }) : null;
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
  });
  return { notice, sent, presence };
}

describe("ProjectCreatedNoticeService", () => {
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
});
