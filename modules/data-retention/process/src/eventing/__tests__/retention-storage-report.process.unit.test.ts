/**
 * The report's processes: the daily wake asks for one sweep, and each organization's billing
 * process asks for one bill per day however often the day's measurement arrives.
 * @see specs/billing/retention-storage-billing.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { type RetentionStorageMeasuredEventData } from "../retention-storage-report.events.ts";
import {
  RETENTION_STORAGE_BILLING_INITIAL_STATE,
  RETENTION_STORAGE_REPORT_INITIAL_STATE,
  retentionStorageMeasured,
  retentionStorageReportWake,
} from "../retention-storage-report.process.ts";

const NOW = Date.UTC(2026, 10, 15, 12);

const intent = intentAccessorOf({
  sweep: (messageKey, payload) => ({ messageKey, intentType: "sweep", payload }),
  bill: (messageKey, payload) => ({ messageKey, intentType: "bill", payload }),
});

const context = { at: NOW, now: NOW, key: "organization-1", projectId: "organization-1", intent };

const measuredOn = (day: string): RetentionStorageMeasuredEventData => ({
  organizationId: "organization-1",
  day,
  longestRetentionDays: 182,
  bytesAboveIncluded: 3_000_000_000,
  gbBeyondIncluded: 3,
  dailyShareGb: 0.1,
  identifier: `retention-storage:organization-1:${day}`,
  measuredAt: NOW,
});

describe("the daily wake", () => {
  it("asks for one sweep keyed by the wake", () => {
    const woken = retentionStorageReportWake(RETENTION_STORAGE_REPORT_INITIAL_STATE, {
      ...context,
      key: "retentionStorageReport",
      projectId: "__global__",
    });

    expect(woken.state).toEqual({ lastSweepAt: NOW });
    expect(woken.intents).toEqual([
      { messageKey: `sweep:${NOW}`, intentType: "sweep", payload: { scheduledFor: NOW } },
    ]);
  });
});

describe("the billing process", () => {
  it("asks for one bill keyed by the day's meter identifier", () => {
    const first = retentionStorageMeasured(
      RETENTION_STORAGE_BILLING_INITIAL_STATE,
      measuredOn("2026-11-15"),
      context,
    );

    expect(first.state).toEqual({ lastBilledDay: "2026-11-15" });
    expect(first.intents).toEqual([
      {
        messageKey: "bill:retention-storage:organization-1:2026-11-15",
        intentType: "bill",
        payload: measuredOn("2026-11-15"),
      },
    ]);
  });

  it("asks for nothing when the same day's measurement arrives again", () => {
    const again = retentionStorageMeasured(
      { lastBilledDay: "2026-11-15" },
      measuredOn("2026-11-15"),
      context,
    );

    expect(again.intents ?? []).toEqual([]);
    expect(again.state).toEqual({ lastBilledDay: "2026-11-15" });
  });

  it("asks for nothing for a day older than the last one billed", () => {
    const late = retentionStorageMeasured(
      { lastBilledDay: "2026-11-15" },
      measuredOn("2026-11-14"),
      context,
    );

    expect(late.intents ?? []).toEqual([]);
  });

  it("asks for the next day's bill", () => {
    const next = retentionStorageMeasured(
      { lastBilledDay: "2026-11-15" },
      measuredOn("2026-11-16"),
      context,
    );

    expect(next.intents).toHaveLength(1);
    expect(next.state).toEqual({ lastBilledDay: "2026-11-16" });
  });
});
