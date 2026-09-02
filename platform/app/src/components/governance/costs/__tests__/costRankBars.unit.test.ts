/**
 * The geometry behind the ranked cost bars.
 *
 * Cost on this screen is signed: a provider that credits or refunds a period
 * reports it as a negative figure, and the ledger keeps it that way so the
 * charge it reverses does not stand alone. A ranked panel that scales every
 * bar against the top row therefore has to survive a top row that is itself a
 * credit — dividing by a negative leader produces a negative width, and
 * guarding that with `leader > 0` collapses an entire panel of credits to
 * nothing.
 *
 * Width is asserted here rather than in the DOM on purpose: the width lands in
 * a generated class name that jsdom cannot resolve, so a rendered assertion
 * would pass no matter what the arithmetic did.
 *
 * Issue: #7768
 */
import { describe, expect, it } from "vitest";

import { rankBarGeometry } from "../CostCharts";

describe("the ranked bar geometry", () => {
  describe("given every row is a charge", () => {
    it("gives the leader the full bar and scales the rest against it", () => {
      const geometry = rankBarGeometry([
        { key: "a", label: "Alpha", value: 100 },
        { key: "b", label: "Beta", value: 25 },
      ]);

      expect(geometry.map((row) => row.widthPct)).toEqual([100, 25]);
      expect(geometry.every((row) => !row.isCredit)).toBe(true);
    });
  });

  describe("given every row is a credit", () => {
    it("draws them against the largest credit rather than collapsing to nothing", () => {
      const geometry = rankBarGeometry([
        { key: "a", label: "Alpha", value: -20 },
        { key: "b", label: "Beta", value: -80 },
      ]);

      // Sorted descending by value, so the smaller credit leads. It is the
      // larger magnitude that sets the scale.
      expect(geometry.map((row) => row.widthPct)).toEqual([25, 100]);
      expect(geometry.every((row) => row.isCredit)).toBe(true);
    });
  });

  describe("given charges and credits together", () => {
    it("never produces a negative width", () => {
      const geometry = rankBarGeometry([
        { key: "a", label: "Alpha", value: 40 },
        { key: "b", label: "Beta", value: -60 },
      ]);

      expect(geometry.every((row) => row.widthPct >= 0)).toBe(true);
      expect(geometry.map((row) => row.widthPct)).toEqual([
        (40 / 60) * 100,
        100,
      ]);
    });

    it("marks the credit so an equal magnitude does not read as an equal charge", () => {
      const geometry = rankBarGeometry([
        { key: "a", label: "Alpha", value: 50 },
        { key: "b", label: "Beta", value: -50 },
      ]);

      expect(geometry.map((row) => [row.key, row.isCredit])).toEqual([
        ["a", false],
        ["b", true],
      ]);
    });
  });

  describe("given nothing was spent on any row", () => {
    it("draws no bars rather than dividing by zero", () => {
      const geometry = rankBarGeometry([
        { key: "a", label: "Alpha", value: 0 },
        { key: "b", label: "Beta", value: 0 },
      ]);

      expect(geometry.map((row) => row.widthPct)).toEqual([0, 0]);
      expect(geometry.every((row) => Number.isFinite(row.widthPct))).toBe(true);
    });
  });
});
