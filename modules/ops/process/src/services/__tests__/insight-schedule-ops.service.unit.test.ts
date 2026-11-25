/** @see modules/ops/specs/daily-insight-schedules.feature */
import type { InsightApi, InsightOperatorDailySchedule } from "@langwatch/insight-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { InsightScheduleOpsService } from "../insight-schedule-ops.service.ts";

const SLOT = Date.parse("2026-10-11T09:17:00.000Z");
const RAN_AT = Date.parse("2026-10-10T09:17:02.000Z");

const schedule = (
  over: Partial<InsightOperatorDailySchedule> = {},
): InsightOperatorDailySchedule => ({
  scheduleId: "insightschedule_1",
  projectId: "project_acme",
  userId: "user_riley",
  board: { kind: "dashboard", id: "dashboard_costs", name: "Costs" },
  state: "on",
  offReason: null,
  settings: { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 3 },
  nextRunAt: SLOT,
  lastRun: {
    at: RAN_AT,
    outcome: "skipped",
    reason: "no_access",
    filedCount: 0,
    renewedCount: 0,
    conversationId: null,
  },
  consecutiveSkips: 2,
  ...over,
});

type Profile = Awaited<ReturnType<UserApi["getProfiles"]>>[number];

type ProjectIdentity = Awaited<ReturnType<ProjectApi["listNamesByIds"]>>[number];

const ACME: ProjectIdentity = {
  id: "project_acme",
  name: "Acme",
  slug: "acme",
  teamId: "team_acme",
  organizationId: "organization_acme",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

function makeService({
  rows,
  projects = async ({ projectIds }) => [ACME].filter(({ id }) => projectIds.includes(id)),
  profiles = [{ id: "user_riley", name: "Riley", email: "riley@example.test" }],
}: {
  rows: InsightOperatorDailySchedule[];
  projects?: ProjectApi["listNamesByIds"];
  profiles?: Pick<Profile, "id" | "name" | "email">[];
}) {
  const limits: number[] = [];
  const service = InsightScheduleOpsService.create({
    insights: createApiFixture<Pick<InsightApi, "findOperatorDailySchedules">>({
      findOperatorDailySchedules: async ({ limit }) => {
        limits.push(limit);
        return rows.slice(0, limit);
      },
    }),
    projects: createApiFixture<Pick<ProjectApi, "listNamesByIds">>({ listNamesByIds: projects }),
    users: createApiFixture<Pick<UserApi, "getProfiles">>({
      getProfiles: async ({ userIds }) =>
        profiles.filter(({ id }) => userIds.includes(id)) as Profile[],
    }),
  });
  return { service, limits };
}

describe("given daily insight schedules in several projects", () => {
  describe("when the operator's list is read", () => {
    /** @scenario "The list names each schedule's project and owner beside its own facts" */
    it("names the project and the owner, and gives each instant as a date", async () => {
      const { service } = makeService({ rows: [schedule()] });

      expect(await service.list({})).toEqual([
        {
          id: "insightschedule_1",
          projectId: "project_acme",
          projectName: "Acme",
          userId: "user_riley",
          owner: "Riley",
          boardKind: "dashboard",
          boardId: "dashboard_costs",
          boardName: "Costs",
          on: true,
          offReason: null,
          hour: 9,
          timezone: "Europe/Amsterdam",
          nextRunAt: "2026-10-11T09:17:00Z",
          lastRunAt: "2026-10-10T09:17:02Z",
          lastRunOutcome: "skipped",
          lastRunReason: "no_access",
          consecutiveSkips: 2,
          skippedDaysBeforeOff: 7,
        },
      ]);
    });

    /** @scenario "A schedule that is off is listed with why, and with no next run" */
    it("lists a schedule the system turned off with its reason and no next run", async () => {
      const off = schedule({ state: "off", offReason: "skipped_days", nextRunAt: null });
      const { service } = makeService({ rows: [off] });

      expect(await service.list({})).toMatchObject([
        { on: false, offReason: "skipped_days", nextRunAt: null, consecutiveSkips: 2 },
      ]);
    });

    it("lists a schedule that never ran and never held a setting with nothing in their place", async () => {
      const declined = schedule({ state: "off", settings: null, lastRun: null, nextRunAt: null });
      const { service } = makeService({ rows: [declined] });

      expect(await service.list({})).toMatchObject([
        { hour: null, timezone: null, lastRunAt: null, lastRunOutcome: null, lastRunReason: null },
      ]);
    });
  });

  describe("when a project or an owner is gone", () => {
    /** @scenario "A project or an owner that is gone is listed by its id" */
    it("lists the schedule with no name for either, and keeps both ids", async () => {
      const orphan = schedule({ projectId: "project_gone", userId: "user_gone" });
      const { service } = makeService({ rows: [orphan] });

      expect(await service.list({})).toMatchObject([
        { projectId: "project_gone", projectName: null, userId: "user_gone", owner: null },
      ]);
    });

    it("still lists the schedules when the project names cannot be read", async () => {
      const { service } = makeService({
        rows: [schedule()],
        projects: async () => {
          throw new Error("project read down");
        },
      });

      expect(await service.list({})).toMatchObject([{ projectName: null, owner: "Riley" }]);
    });

    it("names an owner with no name by their address", async () => {
      const { service } = makeService({
        rows: [schedule()],
        profiles: [{ id: "user_riley", name: null, email: "riley@example.test" }],
      });

      expect(await service.list({})).toMatchObject([{ owner: "riley@example.test" }]);
    });
  });

  describe("when a limit is asked for", () => {
    /** @scenario "The list is bounded" */
    it("asks insight for 200 by default, and never for fewer than 1 or more than 500", async () => {
      const { service, limits } = makeService({ rows: [] });

      await service.list({});
      await service.list({ limit: 0 });
      await service.list({ limit: 5_000 });
      await service.list({ limit: 25 });

      expect(limits).toEqual([200, 1, 500, 25]);
    });
  });
});
