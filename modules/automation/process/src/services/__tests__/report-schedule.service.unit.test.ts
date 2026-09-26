import {
  buildIntentFactories,
  InMemoryProcessStore,
  type ProcessEvolution,
} from "@langwatch/eventing";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { AutomationClock } from "../../app/automation.members.ts";
import { reportDispatchIntentSchema } from "../../eventing/report-schedule.intent.ts";
import {
  INITIAL_REPORT_SCHEDULE_STATE,
  REPORT_SCHEDULE_PROCESS_NAME,
  reportRunRequested,
  reportScheduleConfigured,
  reportSchedulePaused,
  reportScheduleResumed,
  type ReportScheduleState,
} from "../../eventing/report-schedule.process.ts";
import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryTriggerRepository } from "../../repositories/memory/memory.trigger.repository.ts";
import { ReportScheduleService } from "../report-schedule.service.ts";

const NOW = Temporal.Instant.from("2026-01-01T08:00:00Z");

class Clock implements AutomationClock {
  now(): Instant {
    return NOW;
  }
}

type Handler<Data> = (
  state: ReportScheduleState,
  data: Data,
  context: Parameters<typeof reportScheduleConfigured>[2],
) => ProcessEvolution<ReportScheduleState>;

/** Each sender runs its event's real handler and commits the result, as the worker would. */
function processBackedSchedules(triggers: MemoryTriggerRepository) {
  const store = InMemoryProcessStore.createForTesting();
  const intents = buildIntentFactories({
    dispatchReport: { schema: reportDispatchIntentSchema, run: async () => {} },
  });
  const sent: string[] = [];
  const sender = <Data extends { triggerId: string }>(name: string, handler: Handler<Data>) => ({
    send: async (payload: Data & { tenantId: string; occurredAt: number }) => {
      sent.push(`${name}:${payload.triggerId}`);
      const ref = {
        processName: REPORT_SCHEDULE_PROCESS_NAME,
        projectId: payload.tenantId,
        processKey: payload.triggerId,
      };
      const existing = await store.findByRef<ReportScheduleState>({ ref });
      const evolution = handler(existing?.state ?? INITIAL_REPORT_SCHEDULE_STATE, payload, {
        at: payload.occurredAt,
        now: payload.occurredAt,
        key: payload.triggerId,
        projectId: payload.tenantId,
        intents,
      });
      await store.commit({
        ref,
        tenantId: payload.tenantId,
        sourceEventId: `${name}:${sent.length}`,
        expectedRevision: existing?.revision ?? 0,
        state: evolution.state,
        nextWakeAt: evolution.nextWakeAt ?? null,
        messages: [],
        now: payload.occurredAt,
      });
    },
    sendBatch: async () => {},
    close: async () => {},
    waitUntilReady: async () => {},
  });
  const service = ReportScheduleService.create({ clock: new Clock(), triggers, instances: store });
  service.connect({
    commands: {
      recordTriggerMatch: sender("recordTriggerMatch", () => {
        throw new Error("the report schedule never records a trigger match");
      }),
      configureReportSchedule: sender("configure", reportScheduleConfigured),
      pauseReportSchedule: sender("pause", reportSchedulePaused),
      resumeReportSchedule: sender("resume", reportScheduleResumed),
      requestReportRun: sender("run", reportRunRequested),
    },
  });
  return { service, sent, store };
}

async function report(
  triggers: MemoryTriggerRepository,
  id: string,
  active = true,
  projectId = "p",
) {
  await triggers.create({
    id,
    projectId,
    name: id,
    action: "SEND_EMAIL",
    actionParams: {
      source: { kind: "dashboard", dashboardId: "dashboard" },
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
      compareToPrevious: false,
    },
    filters: {},
  });
  await triggers.update({ id, projectId, triggerKind: "REPORT", active });
}

describe("ReportScheduleService", () => {
  describe("given a report saved at 08:00 for a daily 09:00 cron", () => {
    /** @scenario "The automations page reads a report's next and last run from its schedule" */
    it("reads the next run from the schedule process and shows a paused one without one", async () => {
      const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
      await report(triggers, "r");
      const { service } = processBackedSchedules(triggers);

      await service.sync({
        projectId: "p",
        triggerId: "r",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
      });
      expect(await service.getAll({ projectId: "p" })).toEqual([
        {
          triggerId: "r",
          nextRunAt: new Date("2026-01-01T09:00:00Z"),
          lastRunAt: null,
          active: true,
        },
      ]);

      await service.remove({ projectId: "p", triggerId: "r" });
      expect(await service.getAll({ projectId: "p" })).toEqual([
        { triggerId: "r", nextRunAt: null, lastRunAt: null, active: false },
      ]);
    });
  });

  describe("given reports that predate the schedule process", () => {
    /** @scenario "Missing report schedules are repaired without resuming paused reports" */
    it("configures each active report once and leaves a paused schedule paused", async () => {
      const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
      await report(triggers, "missing");
      await report(triggers, "paused");
      const { service, sent } = processBackedSchedules(triggers);
      await service.sync({
        projectId: "p",
        triggerId: "paused",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
      });
      await service.remove({ projectId: "p", triggerId: "paused" });

      expect(await service.reconcile()).toEqual({ repaired: 1 });
      expect(await service.reconcile()).toEqual({ repaired: 0 });
      expect(sent).toEqual(["configure:paused", "pause:paused", "configure:missing"]);
      expect(
        (await service.getAll({ projectId: "p" }))
          .toSorted((left, right) => left.triggerId.localeCompare(right.triggerId))
          .map(({ triggerId, active }) => [triggerId, active]),
      ).toEqual([
        ["missing", true],
        ["paused", false],
      ]);
    });
  });

  describe("given reports in two projects, one paused by an operator", () => {
    /** @scenario "The operator scheduler lists every report's schedule across projects" */
    it("lists each configured report with its project and cron, the paused one without a next run", async () => {
      const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
      await report(triggers, "daily", true, "p");
      await report(triggers, "weekly", true, "q");
      await report(triggers, "unconfigured", true, "q");
      const { service } = processBackedSchedules(triggers);
      await service.sync({
        projectId: "p",
        triggerId: "daily",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
      });
      await service.sync({
        projectId: "q",
        triggerId: "weekly",
        schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
      });
      await service.setActive({ projectId: "q", triggerId: "weekly", active: false });

      const schedules = (await service.findAllAcrossProjects()).toSorted((left, right) =>
        left.triggerId.localeCompare(right.triggerId),
      );

      expect(
        schedules.map(({ triggerId, projectId, cron, timezone, active, nextRunAt }) => ({
          triggerId,
          projectId,
          cron,
          timezone,
          active,
          nextRunAt,
        })),
      ).toEqual([
        {
          triggerId: "daily",
          projectId: "p",
          cron: "0 9 * * *",
          timezone: "UTC",
          active: true,
          nextRunAt: new Date("2026-01-01T09:00:00Z"),
        },
        {
          triggerId: "weekly",
          projectId: "q",
          cron: "0 9 * * 1",
          timezone: "Europe/Amsterdam",
          active: false,
          nextRunAt: null,
        },
      ]);
    });
  });

  describe("given a scheduled report", () => {
    /** @scenario "An operator's pause and resume drive the report's schedule" */
    it("holds no wake while paused and wakes at the next slot once resumed", async () => {
      const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
      await report(triggers, "r");
      const { service, sent } = processBackedSchedules(triggers);
      await service.sync({
        projectId: "p",
        triggerId: "r",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
      });

      await service.setActive({ projectId: "p", triggerId: "r", active: false });
      const [paused] = await service.findAllAcrossProjects();
      await service.setActive({ projectId: "p", triggerId: "r", active: true });
      const [resumed] = await service.findAllAcrossProjects();

      expect(sent).toEqual(["configure:r", "pause:r", "resume:r"]);
      expect([paused?.active, paused?.nextRunAt]).toEqual([false, null]);
      expect([resumed?.active, resumed?.nextRunAt]).toEqual([
        true,
        new Date("2026-01-01T09:00:00Z"),
      ]);
    });

    /** @scenario "Each operator run-now is its own request" */
    it("sends each run-now as a distinct request and keeps the cadence", async () => {
      const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
      await report(triggers, "r");
      const { service, sent, store } = processBackedSchedules(triggers);
      await service.sync({
        projectId: "p",
        triggerId: "r",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
      });
      const ref = { processName: REPORT_SCHEDULE_PROCESS_NAME, projectId: "p", processKey: "r" };

      await service.requestRun({ projectId: "p", triggerId: "r" });
      const first = (await store.findByRef<ReportScheduleState>({ ref }))?.state.lastRunRequestId;
      await service.requestRun({ projectId: "p", triggerId: "r" });
      const second = (await store.findByRef<ReportScheduleState>({ ref }))?.state.lastRunRequestId;

      expect(sent).toEqual(["configure:r", "run:r", "run:r"]);
      expect(first).toEqual(expect.any(String));
      expect(second).not.toBe(first);
      expect((await service.getAll({ projectId: "p" }))[0]?.nextRunAt).toEqual(
        new Date("2026-01-01T09:00:00Z"),
      );
    });
  });
});
