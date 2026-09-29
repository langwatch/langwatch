/**
 * The URL fragment carries the Instant Eval runs behind the query's `eval`
 * chips, so a refresh or a shared link reuses the judgements.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("The run id rides in
 * the URL fragment").
 */
import { describe, expect, it } from "vitest";
import { buildFragment, computeOverrides, parseFragment } from "../urlState";

describe("given a fragment carrying two run entries", () => {
  describe("when it is parsed", () => {
    /** @scenario "The run id rides in the URL fragment" */
    it("reads both runs back keyed by their key, and builds the same entries", () => {
      const fragment =
        "#all-traces?q=eval%3A%22annoyed%22&preset=7d&run=abcd1234%3Arun-1&run=ffff0000%3Arun-2";
      const parsed = parseFragment(fragment);
      expect(parsed).toEqual({
        lensId: "all-traces",
        overrides: {
          query: 'eval:"annoyed"',
          preset: "7d",
          runs: { abcd1234: "run-1", ffff0000: "run-2" },
        },
      });
      const rebuilt = buildFragment("all-traces", parsed!.overrides);
      expect(parseFragment(`#${rebuilt}`)).toEqual(parsed);
      expect(rebuilt).toContain("run=abcd1234%3Arun-1");
      expect(rebuilt).toContain("run=ffff0000%3Arun-2");
    });

    it("ignores an entry with no key or no run id", () => {
      const parsed = parseFragment(
        "#all-traces?q=x&run=abcd&run=%3Arun-1&run=k%3A",
      );
      expect(parsed?.overrides.runs).toBeUndefined();
    });
  });
});

describe("computeOverrides", () => {
  it("writes the runs only when there are any", () => {
    expect(
      computeOverrides({
        query: 'eval:"annoyed"',
        timeRange: { from: 1, to: 2, presetId: "30d" },
        defaultPresetId: "30d",
        runs: {},
      }),
    ).toEqual({ query: 'eval:"annoyed"' });
    expect(
      computeOverrides({
        query: 'eval:"annoyed"',
        timeRange: { from: 1, to: 2, presetId: "30d" },
        defaultPresetId: "30d",
        runs: { k: "run-1" },
      }),
    ).toEqual({ query: 'eval:"annoyed"', runs: { k: "run-1" } });
  });
});
