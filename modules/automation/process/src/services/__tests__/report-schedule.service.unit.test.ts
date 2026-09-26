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
  return { service, sent };
}

async function report(triggers: MemoryTriggerRepository, id: string, active = true) {
  await triggers.create({
    id,
    projectId: "p",
    name: id,
    action: "SEND_EMAIL",
    actionParams: {
      source: { kind: "dashboard", dashboardId: "dashboard" },
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
      compareToPrevious: false,
    },
    filters: {},
  });
  await triggers.update({ id, projectId: "p", triggerKind: "REPORT", active });
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
});
