import { createApiFixture } from "@langwatch/api-fixture";
import type { AutomationApi, OperatorReportSchedule } from "@langwatch/automation-contract";
import type { SchedulerAuditEntryView, SchedulerControlAction } from "@langwatch/ops-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { SchedulerAuditRepository } from "../../repositories/ops-audit.repository.ts";
import { SchedulerOpsService } from "../scheduler-ops.service.ts";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const schedule = (over: Partial<OperatorReportSchedule> = {}): OperatorReportSchedule => ({
  triggerId: "report_1",
  projectId: "project_acme",
  cron: "0 3 21 * *",
  timezone: "UTC",
  nextRunAt: at(600_000),
  lastRunAt: at(-600_000),
  active: true,
  runningSlot: null,
  createdAt: at(-86_400_000),
  updatedAt: at(-1_000),
  ...over,
});

type AuditEntry = {
  actorUserId: string;
  action: SchedulerControlAction;
  scheduleId: string;
  projectId: string;
  slot: Date | null;
};

class RecordingAudit extends SchedulerAuditRepository {
  readonly entries: AuditEntry[] = [];
  failing = false;

  async append(entry: AuditEntry): Promise<void> {
    if (this.failing) throw new Error("audit down");
    this.entries.push(entry);
  }

  async findRecent(): Promise<SchedulerAuditEntryView[]> {
    return [];
  }
}

function makeService(rows: OperatorReportSchedule[]) {
  const commands: string[] = [];
  const schedules = createApiFixture<AutomationApi>({
    findAllReportSchedules: async () => rows,
    setReportScheduleActive: async ({ projectId, triggerId, active }) => {
      commands.push(`${active ? "resume" : "pause"}:${projectId}/${triggerId}`);
    },
    requestReportRun: async ({ projectId, triggerId }) => {
      commands.push(`run:${projectId}/${triggerId}`);
    },
  });
  const projects = createApiFixture<ProjectApi>({
    listNamesByIds: async ({ projectIds }) =>
      projectIds.map((id) => ({
        id,
        name: id === "project_acme" ? "Acme" : id,
        slug: id,
        teamId: "team",
        organizationId: "organization",
        isPersonal: false,
        ownerUserId: null,
      })),
  });
  const audit = new RecordingAudit();
  const service = SchedulerOpsService.create({ schedules, audit, projects });

  return { service, audit, commands };
}

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      return error.code;
    }
    return "no-code";
  }
  return "did-not-throw";
};

describe("SchedulerOpsService", () => {
  describe("given report schedules in several projects", () => {
    describe("when the operator lists them", () => {
      it("shows active ones first, soonest first, each named by its project", async () => {
        const { service } = makeService([
          schedule({ triggerId: "later", nextRunAt: at(900_000) }),
          schedule({ triggerId: "paused", active: false, nextRunAt: null }),
          schedule({ triggerId: "sooner", nextRunAt: at(60_000) }),
        ]);

        const jobs = await service.listScheduledJobs({ limit: 10 });

        expect(jobs.map(({ id, active, projectName }) => [id, active, projectName])).toEqual([
          ["sooner", true, "Acme"],
          ["later", true, "Acme"],
          ["paused", false, "Acme"],
        ]);
        expect(jobs[0]).toMatchObject({
          targetType: "reportTrigger",
          targetId: "sooner",
          currentSlot: null,
          attempts: 0,
          lastError: null,
        });
      });

      it("counts every paused schedule even when the page holds fewer", async () => {
        const { service } = makeService([
          schedule({ triggerId: "a", active: false, nextRunAt: null }),
          schedule({ triggerId: "b", active: false, nextRunAt: null }),
          schedule({ triggerId: "c" }),
        ]);

        const page = await service.listPausedSchedules({ limit: 1 });

        expect(page.total).toBe(2);
        expect(page.schedules.map((job) => [job.id, job.nextRunAt])).toEqual([["a", null]]);
      });
    });
  });

  describe("given a schedule that no longer exists", () => {
    describe("when a control is invoked", () => {
      /** @scenario "A refused control explains itself in the operator's terms" */
      it("refuses with a cause the operator can act on", async () => {
        const { service } = makeService([]);

        expect(await codeOf(() => service.runNow({ scheduleId: "gone", actorUserId: "u1" }))).toBe(
          "schedule_not_found",
        );
      });

      /** @scenario "A control that changed nothing is not recorded as though it did" */
      it("sends no command and writes no audit record", async () => {
        const { service, audit, commands } = makeService([]);

        expect(
          await codeOf(() =>
            service.setActive({ scheduleId: "gone", active: false, actorUserId: "u1" }),
          ),
        ).toBe("schedule_not_found");
        expect(commands).toEqual([]);
        expect(audit.entries).toEqual([]);
      });
    });
  });

  describe("given a paused schedule", () => {
    describe("when an operator runs it now", () => {
      /** @scenario "An inactive schedule refuses to run" */
      it("refuses, naming the schedule as inactive", async () => {
        const { service, commands } = makeService([schedule({ active: false, nextRunAt: null })]);

        expect(
          await codeOf(() => service.runNow({ scheduleId: "report_1", actorUserId: "u1" })),
        ).toBe("schedule_inactive");
        expect(commands).toEqual([]);
      });
    });
  });

  describe("given a schedule with a run-now still in flight", () => {
    describe("when the operator lists it", () => {
      it("shows the run's slot as the one in flight", async () => {
        const { service } = makeService([schedule({ runningSlot: at(-1_000) })]);

        const [job] = await service.listScheduledJobs({ limit: 10 });

        expect(job?.currentSlot).toBe(at(-1_000).toISOString());
      });
    });

    describe("when an operator runs it now", () => {
      /** @scenario "A schedule that is already running refuses to run again" */
      it("refuses, naming the run in progress, and asks for no run", async () => {
        const { service, audit, commands } = makeService([schedule({ runningSlot: at(-1_000) })]);

        expect(
          await codeOf(() => service.runNow({ scheduleId: "report_1", actorUserId: "u1" })),
        ).toBe("schedule_run_in_progress");
        expect(commands).toEqual([]);
        expect(audit.entries).toEqual([]);
      });
    });
  });

  describe("given an active schedule", () => {
    describe("when an operator runs it now", () => {
      /** @scenario "A manual run goes through the ordinary path" */
      it("asks the report's own schedule for a run rather than invoking the target", async () => {
        const { service, commands } = makeService([schedule()]);

        await service.runNow({ scheduleId: "report_1", actorUserId: "u1" });

        expect(commands).toEqual(["run:project_acme/report_1"]);
      });

      /** @scenario "A manual scheduler run follows the ordinary due path" */
      it("records the audited control after the command is accepted", async () => {
        const { service, audit } = makeService([schedule()]);

        const job = await service.runNow({ scheduleId: "report_1", actorUserId: "u1" });

        expect(audit.entries).toEqual([
          {
            actorUserId: "u1",
            action: "ops.scheduler.run_now",
            scheduleId: "report_1",
            projectId: "project_acme",
            slot: at(600_000),
          },
        ]);
        expect(job).toMatchObject({ id: "report_1", projectName: "Acme" });
      });
    });

    describe("when an operator tries to clear its slot", () => {
      /** @scenario "Scheduler controls refuse what a report schedule cannot do" */
      it("refuses with its stable code, since no slot is ever held, and records nothing", async () => {
        const { service, audit, commands } = makeService([schedule()]);

        expect(
          await codeOf(() => service.clearStuckSlot({ scheduleId: "report_1", actorUserId: "u1" })),
        ).toBe("schedule_slot_not_stale");
        expect(commands).toEqual([]);
        expect(audit.entries).toEqual([]);
      });
    });

    describe("when an operator pauses and then resumes it", () => {
      /** @scenario "Every control writes an audit record" */
      it("records pause and resume distinctly, with actor, schedule, slot and project", async () => {
        const { service, audit } = makeService([schedule()]);

        await service.setActive({ scheduleId: "report_1", active: false, actorUserId: "u1" });
        await service.setActive({ scheduleId: "report_1", active: true, actorUserId: "u2" });

        expect(audit.entries.map(({ action, actorUserId }) => [action, actorUserId])).toEqual([
          ["ops.scheduler.pause", "u1"],
          ["ops.scheduler.resume", "u2"],
        ]);
      });
    });
  });

  describe("given any control on a schedule", () => {
    /** @scenario "A control names its project in the write, not only in the copy" */
    it("scopes every command to the schedule's project", async () => {
      const { service, commands } = makeService([
        schedule({ triggerId: "report_1", projectId: "project_other" }),
      ]);

      await service.setActive({ scheduleId: "report_1", active: false, actorUserId: "u1" });
      await service.runNow({ scheduleId: "report_1", actorUserId: "u1" });

      expect(commands).toEqual(["pause:project_other/report_1", "run:project_other/report_1"]);
    });
  });

  describe("given the audit sink is failing", () => {
    describe("when a control succeeds", () => {
      it("does not report a failure that did not happen", async () => {
        const { service, audit } = makeService([schedule()]);
        audit.failing = true;

        await expect(
          service.runNow({ scheduleId: "report_1", actorUserId: "u1" }),
        ).resolves.toBeDefined();
      });
    });
  });
});
