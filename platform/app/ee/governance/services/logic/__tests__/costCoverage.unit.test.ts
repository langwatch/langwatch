// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reading the key-to-bill mapping as of a day (ADR-128 §7).
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import { describe, expect, it } from "vitest";

import type { CoveragePeriod } from "../../../repositories/ingestionSourceKeyCoverage.repository";
import { coverageOnDay, isUtcMidnight } from "../costCoverage";

const period = (overrides: {
  ingestionSourceId: string;
  validFrom: string;
  validTo?: string;
  virtualKeyId?: string;
}): CoveragePeriod => ({
  id: `cov_${overrides.ingestionSourceId}_${overrides.validFrom}`,
  ingestionSourceId: overrides.ingestionSourceId,
  virtualKeyId: overrides.virtualKeyId ?? "vk_1",
  validFrom: new Date(overrides.validFrom),
  validTo: overrides.validTo ? new Date(overrides.validTo) : null,
});

describe("Feature: which bill covered a key is read as of the day being drawn", () => {
  describe("given a key covered by one bill until June and another from June", () => {
    const periods = [
      period({
        ingestionSourceId: "bill_1",
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2026-06-01T00:00:00.000Z",
      }),
      period({
        ingestionSourceId: "bill_2",
        validFrom: "2026-06-01T00:00:00.000Z",
      }),
    ];

    /** @scenario "A past month keeps the bill that covered it at the time" */
    it("files each month under the bill that covered it at the time", () => {
      expect(coverageOnDay({ periods, day: "2026-05-31" }).get("vk_1")).toBe(
        "bill_1",
      );
      expect(coverageOnDay({ periods, day: "2026-06-01" }).get("vk_1")).toBe(
        "bill_2",
      );
    });

    it("leaves the changeover day to the successor alone", () => {
      // The predecessor ends at the same instant the successor begins, so the
      // half-open ranges give the first of June to the successor and to nobody
      // else. Asserted by the ambiguity check below rather than by counting the
      // map, whose keys would hide a second claim by overwriting the first.
      expect(() => coverageOnDay({ periods, day: "2026-06-01" })).not.toThrow();
      expect(coverageOnDay({ periods, day: "2026-06-01" }).get("vk_1")).toBe(
        "bill_2",
      );
    });
  });

  describe("given two bills that both somehow claim a key on one day", () => {
    it("refuses to pick one rather than attributing the money at random", () => {
      // Unreachable while the exclusion constraint stands. Reaching it means the
      // constraint is gone, and quietly keeping the last row read is the
      // last-writer-wins attribution that constraint exists to prevent.
      const overlapping = [
        period({
          ingestionSourceId: "bill_1",
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: "2026-07-01T00:00:00.000Z",
        }),
        period({
          ingestionSourceId: "bill_2",
          validFrom: "2026-06-01T00:00:00.000Z",
        }),
      ];

      expect(() =>
        coverageOnDay({ periods: overlapping, day: "2026-06-15" }),
      ).toThrow(/Two ingestion sources cover gateway key vk_1/);
    });
  });

  describe("given a key whose coverage began in June", () => {
    const periods = [
      period({
        ingestionSourceId: "bill_2",
        validFrom: "2026-06-01T00:00:00.000Z",
      }),
    ];

    /** @scenario "A key covered by nobody on that day belongs to no bill" */
    it("leaves the key out of the mapping for earlier days", () => {
      expect(coverageOnDay({ periods, day: "2026-05-31" }).has("vk_1")).toBe(
        false,
      );
    });
  });

  describe("given several keys with different coverage", () => {
    it("answers for each key independently", () => {
      const periods = [
        period({
          ingestionSourceId: "bill_1",
          virtualKeyId: "vk_1",
          validFrom: "2026-01-01T00:00:00.000Z",
        }),
        period({
          ingestionSourceId: "bill_2",
          virtualKeyId: "vk_2",
          validFrom: "2026-05-01T00:00:00.000Z",
        }),
      ];

      const may = coverageOnDay({ periods, day: "2026-05-15" });
      expect(may.get("vk_1")).toBe("bill_1");
      expect(may.get("vk_2")).toBe("bill_2");

      const april = coverageOnDay({ periods, day: "2026-04-15" });
      expect(april.get("vk_1")).toBe("bill_1");
      expect(april.has("vk_2")).toBe(false);
    });
  });
});

describe("Feature: coverage starts on a date", () => {
  it("accepts a UTC midnight", () => {
    expect(isUtcMidnight(new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("refuses any instant inside a day", () => {
    expect(isUtcMidnight(new Date("2026-06-01T12:00:00.000Z"))).toBe(false);
    expect(isUtcMidnight(new Date("2026-06-01T00:00:00.001Z"))).toBe(false);
  });
});
