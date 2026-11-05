import { describe, expect, it } from "vitest";

import { PI_MIN_VERSION, parsePiVersion, piPrespawnWarnings } from "../pi-prespawn";

describe("piPrespawnWarnings()", () => {
  describe("when the installed pi is older than the minimum", () => {
    /** @scenario An installed pi below the minimum version gets a warning and the run continues */
    it("warns once, naming the installed and the minimum version", () => {
      const warnings = piPrespawnWarnings({ readVersionImpl: () => "0.80.4" });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("pi 0.80.4");
      expect(warnings[0]).toContain(PI_MIN_VERSION);
    });
  });

  describe("when the installed pi is at or above the minimum", () => {
    it.each([PI_MIN_VERSION, "0.84.2", "1.0.0"])("does not warn for %s", (version) => {
      expect(piPrespawnWarnings({ readVersionImpl: () => version })).toEqual([]);
    });
  });

  describe("when the version cannot be read", () => {
    it("does not warn", () => {
      expect(piPrespawnWarnings({ readVersionImpl: () => null })).toEqual([]);
    });
  });
});

describe("parsePiVersion()", () => {
  it("reads the bare version pi prints", () => {
    expect(parsePiVersion("0.84.2\n")).toBe("0.84.2");
  });

  it("returns null for output with no version", () => {
    expect(parsePiVersion("pi: command not found")).toBeNull();
    expect(parsePiVersion(null)).toBeNull();
  });
});
