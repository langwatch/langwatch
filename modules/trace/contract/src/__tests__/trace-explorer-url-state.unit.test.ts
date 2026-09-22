/**
 * The Explorer's address: what the fragment carries for the query's eval chips.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import { buildFragment, computeOverrides, parseFragment } from "../trace-explorer-url-state.ts";

const RUNS = { "0000aaaa": "run-1", "0000bbbb": "run-2" };

describe("given a fragment carrying two run entries", () => {
  describe("when it is parsed", () => {
    /** @scenario "The run id rides in the URL fragment" */
    it("reads both back by key, and writes the same two entries", () => {
      const parsed = parseFragment("#all-traces?q=eval&run=0000aaaa:run-1&run=0000bbbb:run-2");

      expect(parsed?.overrides.runs).toEqual(RUNS);
      expect(buildFragment("all-traces", parsed?.overrides ?? {})).toBe(
        "all-traces?q=eval&run=0000aaaa%3Arun-1&run=0000bbbb%3Arun-2",
      );
    });
  });
});

describe("given a fragment whose run entry has no run id", () => {
  describe("when it is parsed", () => {
    it("carries no run, rather than a key standing for nothing", () => {
      expect(parseFragment("#all-traces?run=0000aaaa:")?.overrides.runs).toBeUndefined();
      expect(parseFragment("#all-traces?run=:run-1")?.overrides.runs).toBeUndefined();
    });
  });
});

describe("given bar state with runs", () => {
  describe("when the overrides are computed", () => {
    it("keeps them beside the query they were judged under", () => {
      const overrides = computeOverrides({
        query: 'eval:"the user is annoyed"',
        timeRange: { from: 1, to: 2, presetId: "30d" },
        defaultPresetId: "30d",
        runs: RUNS,
      });

      expect(overrides.runs).toEqual(RUNS);
    });

    it("keeps none when none was registered", () => {
      const overrides = computeOverrides({
        query: "status:error",
        timeRange: { from: 1, to: 2, presetId: "30d" },
        defaultPresetId: "30d",
        runs: {},
      });

      expect(overrides.runs).toBeUndefined();
    });
  });
});
