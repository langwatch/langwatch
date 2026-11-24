/**
 * @vitest-environment node
 * The order of a schedule's runs: by when they started, by slot for a run that carries no start
 * (a slot is never after its start), by run id on a tie, and a run is never older than itself.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { describe, expect, it } from "vitest";

import { compareRunOrder, isOlderRun } from "../insight-daily-run-order.rules.ts";

const T0 = Date.UTC(2026, 10, 19, 9, 37);
const HOUR = 60 * 60_000;

describe("given two runs that carry their start, the later one for an earlier slot", () => {
  const operator = { runId: "request-1", slot: T0 + 3 * HOUR, since: T0 + 3 * HOUR };
  const lateWake = { runId: `slot:${T0}`, slot: T0, since: T0 + 4 * HOUR };

  describe("when they are compared", () => {
    /** @scenario "Two runs that carry their start are ordered by it, whatever their slots" */
    it("orders them by their start", () => {
      expect(compareRunOrder(operator, lateWake)).toBeLessThan(0);
      expect(compareRunOrder(lateWake, operator)).toBeGreaterThan(0);
      expect(compareRunOrder(lateWake, { ...lateWake })).toBe(0);
      expect(isOlderRun({ run: operator, newest: lateWake })).toBe(true);
      expect(isOlderRun({ run: lateWake, newest: operator })).toBe(false);
    });
  });
});

describe("given a run that carries its start beside one that carries none", () => {
  const keyed = { runId: `slot:${T0}`, slot: T0, since: T0 + HOUR };
  const laterSlot = { runId: "request-1", slot: T0 + 3 * HOUR };
  const earlierSlot = { runId: "request-0", slot: T0 - 3 * HOUR, since: null };

  describe("when they are compared", () => {
    /** @scenario "A run that carries no start is ordered by its slot against the other's start" */
    it("orders the one that carries none by its slot against the other's start", () => {
      expect(compareRunOrder(keyed, laterSlot)).toBeLessThan(0);
      expect(compareRunOrder(keyed, earlierSlot)).toBeGreaterThan(0);
      expect(isOlderRun({ run: keyed, newest: laterSlot })).toBe(true);
      expect(isOlderRun({ run: laterSlot, newest: keyed })).toBe(false);
    });
  });
});

describe("given the same run, once with its start and once as an older worker carried it", () => {
  const withStart = { runId: `slot:${T0}`, slot: T0, since: T0 + 4 * HOUR };
  const withoutStart = { runId: `slot:${T0}`, slot: T0 };

  it("holds neither as older than the other", () => {
    expect(compareRunOrder(withoutStart, withStart)).toBe(0);
    expect(isOlderRun({ run: withoutStart, newest: withStart })).toBe(false);
    expect(isOlderRun({ run: withStart, newest: withoutStart })).toBe(false);
  });
});

describe("given two runs that carry no start", () => {
  const older = { runId: "slot-b", slot: T0 };
  const newer = { runId: "slot-a", slot: T0 + HOUR, since: null };

  describe("when they are compared", () => {
    /** @scenario "Two runs that carry no start are ordered by their slot" */
    it("orders them by their slot", () => {
      expect(compareRunOrder(older, newer)).toBeLessThan(0);
      expect(isOlderRun({ run: older, newest: newer })).toBe(true);
      expect(isOlderRun({ run: newer, newest: older })).toBe(false);
    });
  });
});

describe("given two runs that started at the same instant", () => {
  const first = { runId: "request-1", slot: T0, since: T0 };
  const second = { runId: "request-2", slot: T0 - HOUR, since: T0 };

  describe("when they are compared", () => {
    /** @scenario "Two runs that started at the same instant are ordered by their run id" */
    it("orders them by run id, whatever their slots, the same way each time", () => {
      expect(compareRunOrder(first, second)).toBeLessThan(0);
      expect(compareRunOrder(second, first)).toBeGreaterThan(0);
      expect(isOlderRun({ run: first, newest: second })).toBe(true);
      expect(isOlderRun({ run: second, newest: first })).toBe(false);
    });
  });
});

describe("given a row that took no run yet", () => {
  it("holds no run as older", () => {
    expect(isOlderRun({ run: { runId: "run-1", slot: T0, since: T0 }, newest: null })).toBe(false);
  });
});
