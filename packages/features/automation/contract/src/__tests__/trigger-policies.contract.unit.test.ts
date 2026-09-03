import { describe, expect, it } from "vitest";
import {
  computeScheduledFor,
  hasActionableTriggerFilters,
  isMatchEverythingTrigger,
} from "../trigger-policies";

const trigger = (overrides: Record<string, unknown> = {}) => ({
  triggerKind: "AUTOMATION" as const,
  customGraphId: null,
  filterQuery: null,
  filters: {},
  ...overrides,
});

describe("automation trigger policies", () => {
  it("keeps notification digests at a shared next window while persist actions dispatch now", () => {
    const now = new Date("2026-05-29T12:02:17.456Z");

    expect(computeScheduledFor({ action: "SEND_EMAIL", cadence: "5min_digest", now })).toEqual(
      new Date("2026-05-29T12:05:00.000Z"),
    );
    expect(
      computeScheduledFor({ action: "ADD_TO_DATASET", cadence: "hourly_digest", now }),
    ).toEqual(now);
    expect(
      computeScheduledFor({ action: "ADD_TO_ANNOTATION_QUEUE", cadence: "15min_digest", now }),
    ).toEqual(now);
  });

  it("treats nested empty filter values as vacuous", () => {
    expect(
      hasActionableTriggerFilters({
        "metadata.labels": { region: [] },
      }),
    ).toBe(false);
    expect(
      hasActionableTriggerFilters({
        "metadata.labels": { region: ["eu"] },
      }),
    ).toBe(true);
  });

  it("classifies only condition-less trace automations", () => {
    expect(isMatchEverythingTrigger(trigger())).toBe(true);
    expect(isMatchEverythingTrigger(trigger({ filters: { status: ["error"] } }))).toBe(false);
    expect(isMatchEverythingTrigger(trigger({ filterQuery: "status:error" }))).toBe(false);
    expect(isMatchEverythingTrigger(trigger({ customGraphId: "graph_1" }))).toBe(false);
    expect(isMatchEverythingTrigger(trigger({ triggerKind: "REPORT" }))).toBe(false);
  });
});
