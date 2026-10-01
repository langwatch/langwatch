/**
 * @vitest-environment node
 * @see modules/project/specs/project-service.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { RecordProjectCreatedCommandData } from "../../eventing/project-lifecycle.events.ts";
import { ProjectCreatedNoticeService } from "../project-created-notice.service.ts";

const admins: Record<string, { organizationId: string; adminUserId: string | null }> = {
  "project-1": { organizationId: "org-1", adminUserId: "admin-1" },
  "project-2": { organizationId: "org-1", adminUserId: "admin-1" },
};

function noticeOver() {
  const sent: RecordProjectCreatedCommandData[] = [];
  const notice = ProjectCreatedNoticeService.create({
    logger: { error: vi.fn() },
    projects: {
      findIdsByOrganization: async () => Object.keys(admins),
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
  });
  return { notice, sent };
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
});
