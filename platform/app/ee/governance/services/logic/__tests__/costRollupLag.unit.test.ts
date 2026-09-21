// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The rollup's lag behind the event log.
 *
 * The assertion is the computed VALUE, never a threshold and never an alert:
 * ADR-128 wave 1 exposes the number as a gauge and sends nothing.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128.
 */
import { describe, expect, it } from "vitest";

import { computeCostRollupLagMs } from "../costRollupLag";

const WINDOW_START = Date.parse("2026-08-01T00:00:00.000Z");
const HOUR_MS = 3_600_000;

describe("computeCostRollupLagMs", () => {
  describe("given events newer than the latest summarized moment", () => {
    /** @scenario "The summary's lag behind the event log is measured" */
    it("reports how far the summary is behind", () => {
      expect(
        computeCostRollupLagMs({
          latestEventOccurredAtMs: Date.parse("2026-08-02T06:00:00.000Z"),
          latestSummarizedOccurredAtMs: Date.parse("2026-08-02T03:00:00.000Z"),
          windowStartMs: WINDOW_START,
        }),
      ).toBe(3 * HOUR_MS);
    });
  });

  describe("given the summary has caught up", () => {
    it("reports no lag", () => {
      const moment = Date.parse("2026-08-02T06:00:00.000Z");
      expect(
        computeCostRollupLagMs({
          latestEventOccurredAtMs: moment,
          latestSummarizedOccurredAtMs: moment,
          windowStartMs: WINDOW_START,
        }),
      ).toBe(0);
    });
  });

  describe("given the lane has no events at all", () => {
    // A quiet deployment must not read as a stalled projection.
    it("reports no lag rather than the wall-clock distance", () => {
      expect(
        computeCostRollupLagMs({
          latestEventOccurredAtMs: null,
          latestSummarizedOccurredAtMs: null,
          windowStartMs: WINDOW_START,
        }),
      ).toBe(0);
    });
  });

  describe("given the lane has events but has summarized nothing", () => {
    it("reports the whole window as the lag", () => {
      expect(
        computeCostRollupLagMs({
          latestEventOccurredAtMs: WINDOW_START + 5 * HOUR_MS,
          latestSummarizedOccurredAtMs: null,
          windowStartMs: WINDOW_START,
        }),
      ).toBe(5 * HOUR_MS);
    });
  });

  describe("given a backdated event arrived after a later one was folded", () => {
    // The summary is ahead, not behind. Negative lag on a gauge would read as
    // a projection running into the future.
    it("reports no lag rather than a negative one", () => {
      expect(
        computeCostRollupLagMs({
          latestEventOccurredAtMs: Date.parse("2026-08-02T01:00:00.000Z"),
          latestSummarizedOccurredAtMs: Date.parse("2026-08-02T06:00:00.000Z"),
          windowStartMs: WINDOW_START,
        }),
      ).toBe(0);
    });
  });
});
