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
  const logger = { error: vi.fn() };
  const notice = ProjectCreatedNoticeService.create({
    logger,
    projects: {
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
      sendBatch: async () => undefined,
    },
    recordProjectLegacyKeyRevoked: { send: async () => undefined },
    recordPresenceSettingChanged: {
      send: async (payload) => {
        presence.push(payload);
      },
      sendBatch: async () => undefined,
    },
    recordProjectMoved: { send: async () => undefined },
    recordProjectArchived: { send: async () => undefined },
    recordProjectDepartmentAssigned: {
      send: async (payload) => {
        departments.push(payload);
      },
      sendBatch: async () => undefined,
    },
    recordProjectTraceSharingDisabled: { send: async () => undefined },
    recordProjectAggregateRuleChanged: { send: async () => undefined },
    recordProjectRevived: { send: async () => undefined },
  });
  return { notice, sent, presence, departments, logger };
}

describe("ProjectCreatedNoticeService", () => {
  /** @scenario "A failed project created fact logs the catch-up that recovers it" */
  it("names the project facts step to retry when recording a new project fails", async () => {
    const { notice, logger } = noticeOver();
    const idle = { send: async () => undefined, sendBatch: async () => undefined };
    notice.connect({
      recordProjectCreated: {
        send: async () => {
          throw new Error("event store down");
        },
        sendBatch: async () => undefined,
      },
      recordProjectLegacyKeyRevoked: { send: async () => undefined },
      recordPresenceSettingChanged: idle,
      recordProjectMoved: { send: async () => undefined },
      recordProjectArchived: { send: async () => undefined },
      recordProjectDepartmentAssigned: idle,
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
      expect.stringContaining("project:record-created-facts"),
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
});
