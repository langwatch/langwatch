import { REPORT_SCHEDULE_EVENT_TYPES } from "@langwatch/automation-contract";
import { buildIntentFactories, type ProcessEvolution } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { automationProcessDefinition } from "../../fixtures/pipeline-test-harness.ts";
import { reportDispatchIntentSchema } from "../report-schedule.intent.ts";
import {
  INITIAL_REPORT_SCHEDULE_STATE,
  reportRunRequested,
  reportScheduleConfigured,
  reportSchedulePaused,
  reportScheduleResumed,
  reportScheduleWake,
  type ReportScheduleState,
} from "../report-schedule.process.ts";

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;
const MONDAY_0800 = at("2026-01-05T08:00:00Z");
const MONDAY_0900 = at("2026-01-05T09:00:00Z");
const TUESDAY_0900 = at("2026-01-06T09:00:00Z");

function context(now: number) {
  return {
    at: now,
    now,
    key: "trigger-1",
    projectId: "project-1",
    intents: buildIntentFactories({
      dispatchReport: { schema: reportDispatchIntentSchema, run: async () => {} },
    }),
  };
}

function configuredAt(now: number): ProcessEvolution<ReportScheduleState> {
  return reportScheduleConfigured(
    INITIAL_REPORT_SCHEDULE_STATE,
    { triggerId: "trigger-1", cron: "0 9 * * *", timezone: "UTC" },
    context(now),
  );
}

describe("report schedule process", () => {
  it("is a keyed process manager driven by the report schedule events", () => {
    const definition = automationProcessDefinition({ name: "reportSchedule" });

    expect(definition.config.schedule).toBeUndefined();
    expect(definition.config.eventTypes.toSorted()).toEqual(
      Object.values(REPORT_SCHEDULE_EVENT_TYPES).toSorted(),
    );
  });

  describe("given a daily 09:00 report saved at 08:00", () => {
    /** @scenario "A saved report is scheduled for its next cron slot" */
    it("arms the wake for 09:00 the same day", () => {
      expect(configuredAt(MONDAY_0800).nextWakeAt).toBe(MONDAY_0900);
    });

    describe("when the clock reaches 09:00", () => {
      /** @scenario "A report fires at its cron time" */
      it("dispatches the 09:00 slot through the outbox and re-arms for the next day", async () => {
        const dispatched: unknown[] = [];
        const definition = automationProcessDefinition({
          name: "reportSchedule",
          reports: { dispatch: async (fire) => void dispatched.push(fire) },
        });
        const wake = reportScheduleWake(configuredAt(MONDAY_0800).state, context(MONDAY_0900));

        expect(wake.nextWakeAt).toBe(TUESDAY_0900);
        const intent = wake.intents![0]!;
        expect(intent.messageKey).toBe(`report:${MONDAY_0900}`);
        await definition.config.intents.dispatchReport!.run(intent.payload, {
          processName: "reportSchedule",
          projectId: "project-1",
          processKey: "trigger-1",
          tenantId: "project-1",
          messageKey: intent.messageKey,
          attempt: 1,
        });
        expect(dispatched).toEqual([
          { projectId: "project-1", triggerId: "trigger-1", slot: MONDAY_0900 },
        ]);
      });
    });

    describe("when the report is paused before 09:00", () => {
      /** @scenario "A paused report does not fire" */
      it("disarms the wake and a stray wake sends nothing", () => {
        const paused = reportSchedulePaused(
          configuredAt(MONDAY_0800).state,
          { triggerId: "trigger-1" },
          context(MONDAY_0800),
        );

        expect(paused.nextWakeAt).toBeNull();
        expect(reportScheduleWake(paused.state, context(MONDAY_0900)).intents).toEqual([]);
      });

      /** @scenario "A resumed report fires at its next cron slot" */
      it("re-arms for the next slot after the resume", () => {
        const paused = reportSchedulePaused(
          configuredAt(MONDAY_0800).state,
          { triggerId: "trigger-1" },
          context(MONDAY_0800),
        );
        const resumed = reportScheduleResumed(
          paused.state,
          { triggerId: "trigger-1" },
          context(MONDAY_0900 + 1),
        );

        expect(resumed.nextWakeAt).toBe(TUESDAY_0900);
      });
    });

    describe("when an operator asks for a run now", () => {
      /** @scenario "Run now sends the report once and keeps the cadence" */
      it("dispatches once per request and leaves the next slot where it was", () => {
        const request = { triggerId: "trigger-1", requestId: "request-1" };
        const first = reportRunRequested(
          configuredAt(MONDAY_0800).state,
          request,
          context(MONDAY_0800),
        );
        const repeat = reportRunRequested(first.state, request, context(MONDAY_0800 + 5));

        expect(first.intents?.map(({ messageKey }) => messageKey)).toEqual(["run:request-1"]);
        expect(first.nextWakeAt).toBe(MONDAY_0900);
        expect(repeat.intents).toEqual([]);
      });
    });
  });
});
