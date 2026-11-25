// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: modules/instant-eval/specs/instant-eval-billing.feature
 */
import { describe, expect, it } from "vitest";

import { instantEvalWindowMs, usageBilledSinceInMonth } from "../instant-eval-meter.rules.ts";

const utcMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
const FEBRUARY = "2026-02";

describe("usageBilledSinceInMonth", () => {
  describe("given one subscription that started on 10 February", () => {
    /** @scenario "Free use before an upgrade mid-month is not reported" */
    it("starts February on the 10th", () => {
      expect(
        usageBilledSinceInMonth({
          billingMonth: FEBRUARY,
          periods: [{ startMs: utcMs("2026-02-10"), endMs: null }],
        }),
      ).toEqual({ outcome: "since", startMs: utcMs("2026-02-10") });
    });
  });

  describe("given a subscription replaced by a new one on 15 February", () => {
    const periods = [
      { startMs: utcMs("2026-02-15"), endMs: null },
      { startMs: utcMs("2025-03-01"), endMs: utcMs("2026-02-15") },
    ];

    /** @scenario "A subscription replaced mid-month keeps the month's window" */
    it("keeps the replaced subscription's start, so the whole month is read", () => {
      const since = usageBilledSinceInMonth({ billingMonth: FEBRUARY, periods });

      expect(since).toEqual({ outcome: "since", startMs: utcMs("2025-03-01") });
      expect(
        instantEvalWindowMs({ billingMonth: FEBRUARY, usageBilledSinceMs: utcMs("2025-03-01") }),
      ).toEqual({ fromMs: utcMs("2026-02-01"), toMs: utcMs("2026-03-01") });
    });
  });

  describe("given a subscription cancelled on the 8th and a new one on the 20th", () => {
    /** @scenario "A subscription replaced mid-month keeps the month's window" */
    it("keeps the first subscription's start", () => {
      expect(
        usageBilledSinceInMonth({
          billingMonth: FEBRUARY,
          periods: [
            { startMs: utcMs("2026-02-20"), endMs: null },
            { startMs: utcMs("2026-02-03"), endMs: utcMs("2026-02-08") },
          ],
        }),
      ).toEqual({ outcome: "since", startMs: utcMs("2026-02-03") });
    });
  });

  describe("given a subscription that started after the month ended", () => {
    /** @scenario "A month that ended before the subscription started reports nothing" */
    it("answers its start, so the month's window covers no time", () => {
      const since = usageBilledSinceInMonth({
        billingMonth: "2026-01",
        periods: [{ startMs: utcMs("2026-02-10"), endMs: null }],
      });

      expect(since).toEqual({ outcome: "since", startMs: utcMs("2026-02-10") });
      expect(
        instantEvalWindowMs({ billingMonth: "2026-01", usageBilledSinceMs: utcMs("2026-02-10") }),
      ).toEqual({ fromMs: utcMs("2026-02-01"), toMs: utcMs("2026-02-01") });
    });

    /** @scenario "A month that ended before the subscription started reports nothing" */
    it("still reads no time when an older subscription ended before the month", () => {
      const since = usageBilledSinceInMonth({
        billingMonth: "2026-01",
        periods: [
          { startMs: utcMs("2026-02-01"), endMs: null },
          { startMs: utcMs("2025-03-01"), endMs: utcMs("2025-09-30") },
        ],
      });

      expect(since).toEqual({ outcome: "since", startMs: utcMs("2026-02-01") });
    });
  });

  describe("given a live subscription with no recorded start", () => {
    /** @scenario "A subscription with no recorded start reports the whole month" */
    it("reads the whole month", () => {
      expect(
        usageBilledSinceInMonth({
          billingMonth: FEBRUARY,
          periods: [
            { startMs: null, endMs: null },
            { startMs: utcMs("2026-02-10"), endMs: null },
          ],
        }),
      ).toEqual({ outcome: "whole_month" });
    });
  });

  describe("given no growth-seat subscription periods", () => {
    /** @scenario "A subscription with no recorded start reports the whole month" */
    it("reads the whole month", () => {
      expect(usageBilledSinceInMonth({ billingMonth: FEBRUARY, periods: [] })).toEqual({
        outcome: "whole_month",
      });
    });
  });

  describe("given a subscription that ended in January and a new one on 10 February", () => {
    /** @scenario "Free use before an upgrade mid-month is not reported" */
    it("ignores the one that ended before the month and starts on the 10th", () => {
      expect(
        usageBilledSinceInMonth({
          billingMonth: FEBRUARY,
          periods: [
            { startMs: utcMs("2026-02-10"), endMs: null },
            { startMs: utcMs("2025-06-01"), endMs: utcMs("2026-01-20") },
          ],
        }),
      ).toEqual({ outcome: "since", startMs: utcMs("2026-02-10") });
    });
  });

  describe("given a subscription that ended at the first instant of February", () => {
    /** @scenario "Free use before an upgrade mid-month is not reported" */
    it("does not count it, since a period's end is exclusive, and starts on the 10th", () => {
      expect(
        usageBilledSinceInMonth({
          billingMonth: FEBRUARY,
          periods: [
            { startMs: utcMs("2026-02-10"), endMs: null },
            { startMs: utcMs("2025-06-01"), endMs: utcMs("2026-02-01") },
          ],
        }),
      ).toEqual({ outcome: "since", startMs: utcMs("2026-02-10") });
    });
  });
});
