import { describe, expect, it } from "vitest";

import type { BTLeaderboard } from "@langwatch/experiment-web";
import type { JudgeIndependence, VerbosityProfile } from "@langwatch/experiment-web";
import type { SampleAdequacy } from "@langwatch/experiment-web";
import {
  buildTrustChecks,
  type LeaderboardTrustPanelProps,
} from "../LeaderboardTrustPanel";
import { DEFAULT_WARN_THRESHOLD } from "../PairwiseLeaderboard";

const leaderboard = (overrides: Partial<BTLeaderboard> = {}): BTLeaderboard => ({
  entries: [],
  winMatrix: {},
  comparisonCount: 60,
  minMatchups: 60,
  hasDegenerate: false,
  didConverge: true,
  comparability: { identifiable: true, groups: [], dominates: [] },
  // No replicates, so separation falls back to comparing the marginal
  // intervals — which is what these expectations were written against.
  scoreDifferenceCI: null,
  bootstrapNonConvergence: null,
  ...overrides,
});

const adequacy = (overrides: Partial<SampleAdequacy> = {}): SampleAdequacy => ({
  comparisonCount: 60,
  rankedVariantCount: 4,
  separatedPairs: 5,
  totalPairs: 6,
  resolution: 5 / 6,
  familyWiseFalsePositiveRate: 1 - Math.pow(0.95, 6),
  ...overrides,
});

const verbosity = (overrides: Partial<VerbosityProfile> = {}): VerbosityProfile => ({
  meanLengthByVariant: {},
  leaderRatio: 1.05,
  leaderMeanLength: 1000,
  fieldMeanLength: 950,
  leaderId: "a",
  ...overrides,
});

const independence = (overrides: Partial<JudgeIndependence> = {}): JudgeIndependence => ({
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

      expect(find(checks, "Answer length").detail).toContain("Not enough output text");
    });
  });

  describe("when the judge declined to call some rows", () => {
    /**
     * Swap-and-reconcile records no verdict when the judge's pick flips with
     * the candidate order. Right call — a flip is not a tie — but the row's
     * evidence leaves the win graph with it, which is how a field comes apart
     * into groups the fit may not rank across. The reader who is told "not
     * enough overlap to rank these" needs to be able to see why.
     */
    it("reports the count and says those rows carry no weight", () => {
      const checks = build({ rowsWithoutVerdict: 4 });

      const check = find(checks, "Rows the judge would not call");
      expect(check.detail).toContain("4 of 64");
      expect(check.detail).toContain("opposite order");
    });

    it("turns amber once they are a large enough share to be the reason", () => {
      const quiet = build({ rowsWithoutVerdict: 4 });
      const loud = build({
        leaderboard: leaderboard({ comparisonCount: 10 }),
        rowsWithoutVerdict: 10,
      });

      expect(find(quiet, "Rows the judge would not call").tone).toBe("note");
      expect(find(loud, "Rows the judge would not call").tone).toBe("warn");
      // At that share, more rows will not help — the judge is the problem.
      expect(find(loud, "Rows the judge would not call").detail).toContain(
        "change the judge model",
      );
    });
  });

  describe("when the judge called every row", () => {
    it("says so rather than staying silent", () => {
      const checks = build({ rowsWithoutVerdict: 0 });

      expect(find(checks, "The judge called every row").tone).toBe("ok");
    });
  });

  describe("when the judge's model id does not name a provider", () => {
    /**
     * `modelFamily` returns null for an id with no `provider/` prefix, which
     * leaves `sharedFamilyVariantIds` empty for the same reason a genuinely
     * independent judge does. Reporting "shares a family with none of the
     * candidates" off that is green because nothing was checked.
     */
    it("says the check could not be made rather than passing it", () => {
      const checks = build({
        judgeIndependence: independence({
          judgeModel: "gpt-5-mini",
          judgeFamily: null,
          sharedFamilyVariantIds: [],
        }),
      });

      const check = find(checks, "Judge independence");
      expect(check.tone).toBe("note");
      expect(check.detail).toContain("cannot be checked");
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
    /** @scenario "An independent judge is confirmed rather than left silent" */
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

describe("buildTrustChecks — what a count across pairs does not promise", () => {
  describe("given several pairs were separated", () => {
    it("states that each pair was judged on its own", () => {
      // The count is several 95% tests reported as one number. Without this
      // it reads as a joint guarantee, which it is not.
      const detail = find(build(), "How much this run settled").detail;

      expect(detail).toContain("Each pair is judged on its own at 95%");
    });

    it("quantifies the chance one of them separated by luck", () => {
      const detail = find(build(), "How much this run settled").detail;

      // 1 - 0.95^6 rounds to 26%.
      expect(detail).toContain("26% chance");
    });
  });

  describe("given nothing was separated", () => {
    it("says nothing about multiplicity, because there is no claim to qualify", () => {
      const detail = find(
        build({ sampleAdequacy: adequacy({ separatedPairs: 0 }) }),
        "How much this run settled",
      ).detail;

      expect(detail).not.toContain("by luck");
    });
  });

  describe("given a single pair", () => {
    it("does not raise multiplicity at all", () => {
      const detail = find(
        build({
          sampleAdequacy: adequacy({
            rankedVariantCount: 2,
            separatedPairs: 1,
            totalPairs: 1,
            resolution: 1,
            familyWiseFalsePositiveRate: null,
          }),
        }),
        "How much this run settled",
      ).detail;

      expect(detail).not.toContain("by luck");
    });
  });
});

describe("buildTrustChecks — margins of error built from unsettled fits", () => {
  describe("given many resamples did not settle", () => {
    /** @scenario "Margins of error built from unsettled fits say so" */
    it("reports the margins as approximate", () => {
      // Distinct from the ranking's own convergence: the intervals come from
      // a thousand OTHER fits, and a run can settle cleanly while they did not.
      const checks = build({
        leaderboard: leaderboard({ bootstrapNonConvergence: 0.3 }),
      });
      const check = find(checks, "Margins of error are approximate");

      expect(check.tone).toBe("warn");
      expect(check.detail).toContain("30%");
    });

    it("keeps it separate from whether the ranking settled", () => {
      const checks = build({
        leaderboard: leaderboard({ bootstrapNonConvergence: 0.3 }),
      });

      expect(find(checks, "Ranking settled").tone).toBe("ok");
    });
  });

  describe("given a handful of awkward resamples", () => {
    it("stays quiet, because that is normal", () => {
      // Warning on any at all would fire on healthy runs and be tuned out.
      const checks = build({
        leaderboard: leaderboard({ bootstrapNonConvergence: 0.01 }),
      });

      expect(checks.some((c) => c.label === "Margins of error are approximate")).toBe(
        false,
      );
    });
  });

  describe("given the bootstrap did not run", () => {
    it("makes no claim about the margins either way", () => {
      const checks = build({
        leaderboard: leaderboard({ bootstrapNonConvergence: null }),
      });

      expect(checks.some((c) => c.label === "Margins of error are approximate")).toBe(
        false,
      );
    });
  });
});

describe("buildTrustChecks — reasons that must be the actual reason", () => {
  describe("given the run produced no leader to compare lengths against", () => {
    /** @scenario "A run with no leader says so rather than blaming missing text" */
    it("says that, rather than claiming no text was recorded", () => {
      // leaderRatio is null when there is no leader OR when no text was
      // captured, and the panel reported the second reason for both. On a
      // no-signal run it told the reader their outputs were missing when
      // they were sitting on screen.
      const checks = build({
        verbosity: verbosity({
          leaderRatio: null,
          leaderMeanLength: null,
          leaderId: null,
          meanLengthByVariant: { a: 900, b: 950 },
        }),
      });

      const detail = find(checks, "Answer length").detail;
      expect(detail).not.toContain("Not enough output text");
      expect(detail).toContain("no single leader");
    });
  });

  describe("given a leader exists but no output text was captured", () => {
    it("still says the text was missing", () => {
      const checks = build({
        verbosity: verbosity({
          leaderRatio: null,
          leaderMeanLength: null,
          leaderId: "a",
          meanLengthByVariant: { a: null, b: null },
        }),
      });

      expect(find(checks, "Answer length").detail).toContain("Not enough output text");
    });
  });

  describe("given the judge shares a family with a variant that is not leading", () => {
    /** @scenario "A judge sharing a family with a variant that is not leading" */
    it("does not tell the reader to discount a lead it does not have", () => {
      // Self-preference inflates that variant's score wherever it sits. Only
      // when it is the leader is there a lead to discount.
      const checks = build({
        leaderboard: leaderboard({
          entries: [
            { variantId: "a", isDegenerate: false } as any,
            { variantId: "b", isDegenerate: false } as any,
          ],
        }),
        judgeIndependence: independence({
          judgeModel: "openai/gpt-5",
          judgeFamily: "openai",
          sharedFamilyVariantIds: ["b"],
        }),
      });

      const detail = find(checks, "Judge independence").detail;
      expect(detail).toContain("warm-premium");
      expect(detail).not.toContain("discount that variant's lead");
    });
  });
});

describe("buildTrustChecks — the sample-size threshold the product actually ships", () => {
  // Every test above passes `warnThreshold: 30` into the fixture, so none of
  // them touches DEFAULT_WARN_THRESHOLD — the value the drawer really uses in
  // three places. Zeroing it meant no run ever warned about a thin sample,
  // and the whole suite stayed green.
  //
  // The thin fixture below is a fixed 5 matchups rather than one derived from
  // the constant. Deriving it would move the fixture along with the constant
  // and quietly stop testing anything, which is how the noise-floor test
  // managed to pass against a build with no floor at all.
  const THIN = 5;

  describe("given a variant with far fewer matchups than the shipped threshold", () => {
    /** @scenario "A sample size too small to trust is called out" */
    it("warns, using the default rather than a value the test chose", () => {
      const checks = build({
        leaderboard: leaderboard({ minMatchups: THIN }),
        warnThreshold: DEFAULT_WARN_THRESHOLD,
      });

      const check = find(checks, "Enough comparisons");
      expect(check.tone).toBe("warn");
      expect(check.detail).toContain(`only ${THIN}`);
    });

    it("keeps the shipped threshold above the thin fixture", () => {
      // Asserted so that lowering the default below 5 fails here loudly
      // instead of silently turning the test above into a no-op.
      expect(DEFAULT_WARN_THRESHOLD).toBeGreaterThan(THIN);
    });
  });

  describe("given a variant comfortably above the shipped threshold", () => {
    it("passes the check", () => {
      const checks = build({
        leaderboard: leaderboard({
          minMatchups: DEFAULT_WARN_THRESHOLD + 10,
        }),
        warnThreshold: DEFAULT_WARN_THRESHOLD,
      });

      expect(find(checks, "Enough comparisons").tone).toBe("ok");
    });
  });
});

/**
 * The step-2 badge is derived from these checks rather than re-listing their
 * conditions, because the parallel boolean it replaced had drifted from the
 * panel TWICE — it knew about neither a graph broken into groups nor a
 * bootstrap whose resamples failed to settle. Both render an amber line inside
 * a step whose border and badge stayed neutral, which is the one thing a
 * "look here" affordance must not do.
 *
 * These pin the derivation, so a check added later cannot go unnoticed by the
 * badge again.
 */
describe("the step badge, derived from the checks", () => {
  const hasProblem = (overrides: Partial<LeaderboardTrustPanelProps> = {}) =>
    build(overrides).some((check) => check.tone === "warn");

  it("stays quiet on a run with nothing wrong", () => {
    expect(hasProblem()).toBe(false);
  });

  it("fires on a graph that broke into groups", () => {
    expect(
      hasProblem({
        leaderboard: leaderboard({
          comparability: {
            identifiable: false,
            groups: [["a"], ["b"]],
            dominates: [
              [false, false],
              [false, false],
            ],
          },
        }),
      }),
    ).toBe(true);
  });

  it("fires on a bootstrap whose resamples did not settle", () => {
    expect(
      hasProblem({
        leaderboard: leaderboard({ bootstrapNonConvergence: 0.61 }),
      }),
    ).toBe(true);
  });

  it("fires when the judge declined a large share of the rows", () => {
    expect(
      hasProblem({
        leaderboard: leaderboard({ comparisonCount: 10 }),
        rowsWithoutVerdict: 10,
      }),
    ).toBe(true);
  });
});
