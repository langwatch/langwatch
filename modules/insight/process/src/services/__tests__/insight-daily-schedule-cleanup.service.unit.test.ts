/**
 * @vitest-environment node
 * The clean-up's own reads and writes, over rows the test holds still: which projects it asks,
 * and that the same fact asks for the same off both times.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import type { InsightScheduleTurnedOffEventData } from "@langwatch/insight-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it } from "vitest";

import type { InsightDailyScheduleRepository } from "../../repositories/insight-daily-schedule.repository.ts";
import type { InsightOnSchedule } from "../../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyRunCommandsService } from "../insight-daily-run-commands.service.ts";
import { InsightDailyScheduleCleanupService } from "../insight-daily-schedule-cleanup.service.ts";

const LEFT_AT = Date.UTC(2026, 9, 10, 8);
const SETTINGS = { hour: 9, timezone: "UTC", maxInsights: 3 } as const;

const onSchedule = ({
  projectId,
  userId,
  boardId = "dashboard-1",
}: {
  projectId: string;
  userId: string;
  boardId?: string;
}): InsightOnSchedule => ({
  scheduleId: `schedule-${projectId}-${userId}-${boardId}`,
  projectId,
  userId,
  board: { kind: "dashboard", id: boardId, name: "Costs" },
  settings: SETTINGS,
});

/** Rows that stay on however often they are turned off: the fold has not caught up. */
const ROWS = [
  onSchedule({ projectId: "project-1", userId: "user-left" }),
  onSchedule({ projectId: "project-1", userId: "user-left", boardId: "dashboard-2" }),
  onSchedule({ projectId: "project-1", userId: "user-stays" }),
  onSchedule({ projectId: "project-2", userId: "user-left" }),
  onSchedule({ projectId: "project-elsewhere", userId: "user-left" }),
];

type Off = InsightScheduleTurnedOffEventData & { tenantId: string; occurredAt: number };

let asked: { projectId: string; userId?: string }[];
let offs: Off[];
let service: InsightDailyScheduleCleanupService;

beforeEach(() => {
  asked = [];
  offs = [];
  service = InsightDailyScheduleCleanupService.create({
    schedules: createApiFixture<Pick<InsightDailyScheduleRepository, "findOnInProject">>({
      findOnInProject: async (input) => {
        asked.push(input);
        return ROWS.filter(
          (row) =>
            row.projectId === input.projectId &&
            (input.userId === undefined || row.userId === input.userId),
        );
      },
    }),
    commands: createApiFixture<Pick<InsightDailyRunCommandsService, "turnOffSchedule">>({
      turnOffSchedule: async (input) => void offs.push(input),
    }),
    projects: createApiFixture<Pick<ProjectApi, "listIdsByOrganization">>({
      listIdsByOrganization: async ({ organizationId }) =>
        organizationId === "organization-1" ? ["project-1", "project-2"] : [],
    }),
  });
});

const removal = { organizationId: "organization-1", userId: "user-left", occurredAt: LEFT_AT };

describe("given a member removed from an organisation with two projects", () => {
  describe("when their schedules are cleaned up", () => {
    /** @scenario "Only the projects of the organisation the member left are asked" */
    it("asks each of the two projects for that member's schedules, and no other project", async () => {
      await service.memberRemoved(removal);

      expect(asked).toEqual([
        { projectId: "project-1", userId: "user-left" },
        { projectId: "project-2", userId: "user-left" },
      ]);
      expect(offs.map(({ tenantId, scheduleId }) => [tenantId, scheduleId])).toEqual([
        ["project-1", "schedule-project-1-user-left-dashboard-1"],
        ["project-1", "schedule-project-1-user-left-dashboard-2"],
        ["project-2", "schedule-project-2-user-left-dashboard-1"],
      ]);
    });

    it("turns each off as the system, with the reason and the fact's own instant", async () => {
      await service.memberRemoved(removal);

      for (const off of offs) {
        expect(off).toMatchObject({
          by: "system",
          reason: "member_removed",
          occurredAt: LEFT_AT,
          userId: "user-left",
        });
      }
    });
  });

  describe("when the same removal is handled twice while the rows still read on", () => {
    it("asks for the same offs both times, so the second is the first again", async () => {
      await service.memberRemoved(removal);
      const first = [...offs];

      await service.memberRemoved(removal);

      expect(offs.slice(first.length)).toEqual(first);
    });
  });
});

describe("given a project that was archived", () => {
  it("turns off every person's schedule in it, and none of another project", async () => {
    await service.projectArchived({ projectId: "project-1", occurredAt: LEFT_AT });

    expect(asked).toEqual([{ projectId: "project-1" }]);
    expect(offs.map(({ userId, reason, board }) => [userId, board.id, reason])).toEqual([
      ["user-left", "dashboard-1", "project_archived"],
      ["user-left", "dashboard-2", "project_archived"],
      ["user-stays", "dashboard-1", "project_archived"],
    ]);
  });
});
