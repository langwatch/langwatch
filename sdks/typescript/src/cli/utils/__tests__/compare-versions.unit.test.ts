/**
 * The version ordering two callers depend on: the copilot version gate, which
 * warns below a floor, and the Claude Code plugin update, which only moves an
 * installed copy forward. Both read the SIGN, so the cases that matter are the
 * ones where a naive string comparison would disagree with a numeric one.
 */

import { describe, expect, it } from "vitest";

import { compareVersions } from "../compare-versions";

describe("compareVersions", () => {
  describe("given two ordinary releases", () => {
    it("orders them oldest first", () => {
      expect(
        compareVersions({ version: "0.1.0", against: "0.2.0" }),
      ).toBeLessThan(0);
      expect(
        compareVersions({ version: "0.2.0", against: "0.1.0" }),
      ).toBeGreaterThan(0);
      expect(compareVersions({ version: "0.2.0", against: "0.2.0" })).toBe(0);
    });

    it("compares components numerically rather than as text", () => {
      // "0.10.0" < "0.9.0" as strings, which would read a release as older
      // than the one it followed and update nothing for the rest of the 0.x.
      expect(
        compareVersions({ version: "0.9.0", against: "0.10.0" }),
      ).toBeLessThan(0);
      expect(
        compareVersions({ version: "1.0.0", against: "0.99.99" }),
      ).toBeGreaterThan(0);
    });
  });

  describe("given a version that is not a plain triple", () => {
    it("reads a missing component as zero", () => {
      expect(compareVersions({ version: "1.2", against: "1.2.0" })).toBe(0);
      expect(
        compareVersions({ version: "1.2", against: "1.2.1" }),
      ).toBeLessThan(0);
    });

    it("reads a suffixed component as its leading digits", () => {
      expect(compareVersions({ version: "2.0.0-rc.1", against: "2.0.0" })).toBe(
        0,
      );
      expect(
        compareVersions({ version: "2.0.0-rc.1", against: "1.9.9" }),
      ).toBeGreaterThan(0);
    });

    it("reads a component that is not a number at all as zero", () => {
      expect(compareVersions({ version: "main", against: "0.0.0" })).toBe(0);
    });
  });
});
