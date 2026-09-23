/**
 * The daily report's schedule: hourly wakes, one report after each 12:00 UTC.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { describe, expect, it, vi } from "vitest";

import { runUsageReport } from "../ops-usage-report.intent.ts";
import { buildOpsUsageReportPipeline } from "../ops-usage-report.pipeline.ts";
import {
  USAGE_REPORT_PROCESS_NAME,
  usageReportWake,
  type UsageReportScheduleState,
} from "../ops-usage-report.process.ts";

const at = (iso: string) => Date.parse(iso);

function wake(state: UsageReportScheduleState, iso: string) {
  const moment = at(iso);
  return usageReportWake(state, {
    at: moment,
    now: moment,
    key: USAGE_REPORT_PROCESS_NAME,
    projectId: "__global__",
    intents: {
      send: (messageKey, payload) => ({ messageKey, intentType: "send", payload }),
    },
  });
}

describe("the usage report schedule", () => {
  describe("given a process that has never woken", () => {
    it("takes a baseline and asks for no report, so the first goes at the next noon", () => {
      const evolution = wake({ lastReportAt: null }, "2026-09-21T15:00:00Z");

      expect(evolution.state).toEqual({ lastReportAt: at("2026-09-21T15:00:00Z") });
      expect(evolution.intents).toBeUndefined();
    });
  });

  describe("given the last report went yesterday", () => {
    const state = { lastReportAt: at("2026-09-20T12:10:00Z") };

    it("waits until 12:00 UTC", () => {
      expect(wake(state, "2026-09-21T11:10:00Z").intents).toBeUndefined();
    });

    it("asks for one report on the first wake after noon, keyed by the day", () => {
      const first = wake(state, "2026-09-21T12:10:00Z");
      const redelivered = wake(state, "2026-09-21T12:40:00Z");

      expect(first.intents).toHaveLength(1);
      expect(first.intents?.[0]?.messageKey).toBe(redelivered.intents?.[0]?.messageKey);
      expect(wake(first.state, "2026-09-21T13:10:00Z").intents).toBeUndefined();
    });
  });
});

describe("the usage report tick", () => {
  it("sends the report and prunes its week-old bookkeeping", async () => {
    const send = vi.fn(async () => "sent");
    const deleteDispatchedBefore = vi.fn(async () => 0);
    const now = at("2026-09-21T12:10:00Z");

    await runUsageReport({ send, deleteDispatchedBefore, now: () => now })();

    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteDispatchedBefore).toHaveBeenCalledWith({
      processName: USAGE_REPORT_PROCESS_NAME,
      before: now - 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("builds a pipeline that schedules the report process", () => {
    const pipeline = buildOpsUsageReportPipeline({
      send: async () => "sent",
      deleteDispatchedBefore: async () => 0,
      now: () => 0,
    });

    expect(pipeline.processManagers.get(USAGE_REPORT_PROCESS_NAME)?.config.schedule).toEqual({
      everyMs: 60 * 60 * 1000,
    });
  });
});
