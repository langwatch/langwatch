import { describe, expect, it } from "vitest";

import type { BTLeaderboard } from "../computeBTLeaderboard";
import type {
  JudgeIndependence,
  VerbosityProfile,
} from "../computeJudgeBiasChecks";
import type { SampleAdequacy } from "../computeSampleAdequacy";
import {
  buildTrustChecks,
  type LeaderboardTrustPanelProps,
} from "../LeaderboardTrustPanel";

const leaderboard = (
  overrides: Partial<BTLeaderboard> = {},
): BTLeaderboard => ({
  entries: [],
  winMatrix: {},
  comparisonCount: 60,
  minMatchups: 60,
  hasDegenerate: false,
  didConverge: true,
  comparability: { identifiable: true, groups: [], dominates: [] },
  ...overrides,
});

const adequacy = (overrides: Partial<SampleAdequacy> = {}): SampleAdequacy => ({
  comparisonCount: 60,
  rankedVariantCount: 4,
  separatedPairs: 5,
  totalPairs: 6,
  resolution: 5 / 6,
  ...overrides,
});

const verbosity = (
  overrides: Partial<VerbosityProfile> = {},
): VerbosityProfile => ({
  meanLengthByVariant: {},
  leaderRatio: 1.05,
  leaderMeanLength: 1000,
  fieldMeanLength: 950,
  ...overrides,
});

const independence = (
  overrides: Partial<JudgeIndependence> = {},
): JudgeIndependence => ({
  judgeModel: "anthropic/claude-sonnet-5",
  judgeFamily: "anthropic",
  sharedFamilyVariantIds: [],
  ...overrides,
});

const build = (overrides: Partial<LeaderboardTrustPanelProps> = {}) =>
  buildTrustChecks({
    leaderboard: leaderboard(),
    warnThreshold: 30,
    sampleAdequacy: adequacy(),
    verbosity: verbosity(),
    judgeIndependence: independence(),
    variantNames: { a: "warm", b: "warm-premium" },
    ...overrides,
  });

const find = (checks: ReturnType<typeof build>, label: string) =>
  checks.find((c) => c.label === label)!;

describe("buildTrustChecks", () => {
  describe("given a clean run", () => {
    it("states every check rather than only the failing ones", () => {
      const checks = build();
      const labels = checks.map((c) => c.label);

      expect(labels).toContain("Enough comparisons");
      expect(labels).toContain("How much this run settled");
      expect(labels).toContain("Answer length");
      expect(labels).toContain("Judge independence");
      expect(checks.every((c) => c.tone !== "warn")).toBe(true);
    });
  });

  describe("when the run separated no pair at all", () => {
    it("warns that the sample bought no ordering", () => {
      const checks = build({
        sampleAdequacy: adequacy({ separatedPairs: 0, resolution: 0 }),
      });

      const check = find(checks, "How much this run settled");
      expect(check.tone).toBe("warn");
      expect(check.detail).toContain("None of the 6 variant pairs");
    });
  });

  describe("when the run separated every pair", () => {
    it("reports a full order", () => {
      const checks = build({
        sampleAdequacy: adequacy({ separatedPairs: 6, resolution: 1 }),
      });

      const check = find(checks, "How much this run settled");
      expect(check.tone).toBe("ok");
      expect(check.detail).toContain("All 6 variant pairs");
    });
  });

  describe("when only some pairs separated", () => {
    it("reports the count as a note, not a failure", () => {
      const check = find(build(), "How much this run settled");

      expect(check.tone).toBe("note");
      expect(check.detail).toContain("5 of 6 variant pairs");
    });
  });

  describe("when only one variant could be ranked", () => {
    it("says there was no pair to separate instead of reporting zero", () => {
      const checks = build({
        sampleAdequacy: adequacy({
          rankedVariantCount: 1,
          separatedPairs: 0,
          totalPairs: 0,
          resolution: null,
        }),
      });

      const check = find(checks, "How much this run settled");
      expect(check.tone).toBe("note");
      expect(check.detail).toContain("no pair to separate");
    });
  });

  describe("when the leader wrote far more than the field", () => {
    // Deliberately a note and not a warning: for plenty of tasks the longer
    // answer genuinely is the better one, and a check that fires on correct
    // results teaches people to skip the panel.
    it("reports the ratio without calling the run a failure", () => {
      const checks = build({ verbosity: verbosity({ leaderRatio: 2.4 }) });

      const check = find(checks, "Answer length");
      expect(check.tone).toBe("note");
      expect(check.detail).toContain("2.4×");
      expect(check.tone).not.toBe("warn");
    });
  });

  describe("when the leader wrote far less than the field", () => {
    it("says so, since that is the opposite of the usual bias", () => {
      const checks = build({ verbosity: verbosity({ leaderRatio: 0.4 }) });

      const check = find(checks, "Answer length");
      expect(check.detail).toContain("opposite of the usual length bias");
    });
  });

  describe("when no output text was recorded", () => {
    it("says the comparison could not be made rather than staying silent", () => {
      const checks = build({ verbosity: verbosity({ leaderRatio: null }) });

      expect(find(checks, "Answer length").detail).toContain(
        "Not enough output text",
      );
    });
  });

  describe("when the judge shares a model family with a candidate", () => {
    it("warns and names the affected variant", () => {
      const checks = build({
        judgeIndependence: independence({
          judgeModel: "openai/gpt-5",
          judgeFamily: "openai",
          sharedFamilyVariantIds: ["a"],
        }),
      });

      const check = find(checks, "Judge independence");
      expect(check.tone).toBe("warn");
      expect(check.detail).toContain("warm");
      expect(check.detail).toContain("openai/gpt-5");
    });
  });

  describe("when no candidate shares the judge's family", () => {
    it("confirms independence rather than leaving it unsaid", () => {
      const check = find(build(), "Judge independence");

      expect(check.tone).toBe("ok");
      expect(check.detail).toContain("shares a model family with none");
    });
  });

  describe("when the run did not record its judging model", () => {
    it("says the check could not be made instead of claiming independence", () => {
      const checks = build({
        judgeIndependence: independence({
          judgeModel: null,
          judgeFamily: null,
        }),
      });

      const check = find(checks, "Judge independence");
      expect(check.tone).toBe("note");
      expect(check.detail).toContain("did not record which model judged");
    });
  });

  describe("when a variant swept every matchup", () => {
    it("still warns about the degenerate variant", () => {
      const checks = build({
        leaderboard: leaderboard({ hasDegenerate: true }),
      });

      expect(find(checks, "Every variant both won and lost").tone).toBe("warn");
    });
  });
});
