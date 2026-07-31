import { describe, expect, it } from "vitest";
import {
  type ConfusionMatrixCounts,
  computeConfusionMatrix,
  type JudgeAnnotationPair,
  kappaAgreementLabel,
  wilsonInterval,
} from "../computeConfusionMatrix";

describe("computeConfusionMatrix", () => {
  describe("given a mixed set of judge/reviewer pairs", () => {
    const pairs: JudgeAnnotationPair[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        rowIndex: i,
        predicted: true,
        actual: true,
      })),
      { rowIndex: 5, predicted: true, actual: false },
      { rowIndex: 6, predicted: false, actual: true },
      { rowIndex: 7, predicted: false, actual: true },
      ...Array.from({ length: 4 }, (_, i) => ({
        rowIndex: 8 + i,
        predicted: false,
        actual: false,
      })),
    ];

    /** @scenario Matrix cells count judge verdict against reviewer verdict */
    it("counts each quadrant correctly", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.truePositive).toBe(5);
      expect(result.falsePositive).toBe(1);
      expect(result.falseNegative).toBe(2);
      expect(result.trueNegative).toBe(4);
      expect(result.total).toBe(12);
    });

    /** @scenario Derived metrics accompany the raw matrix */
    it("computes accuracy as (TP + TN) / total", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.accuracy).toBeCloseTo(9 / 12, 5);
    });

    /** @scenario Derived metrics accompany the raw matrix */
    it("computes precision as TP / (TP + FP)", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.precision).toBeCloseTo(5 / 6, 5);
    });

    /** @scenario Derived metrics accompany the raw matrix */
    it("computes recall as TP / (TP + FN)", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.recall).toBeCloseTo(5 / 7, 5);
    });

    /** @scenario Derived metrics accompany the raw matrix */
    it("computes F1 as the harmonic mean of precision and recall", () => {
      const result = computeConfusionMatrix(pairs);
      const precision = 5 / 6;
      const recall = 5 / 7;
      const expectedF1 = (2 * precision * recall) / (precision + recall);
      expect(result.f1).toBeCloseTo(expectedF1, 5);
    });

    it("computes false positive rate as FP / (FP + TN)", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.falsePositiveRate).toBeCloseTo(1 / 5, 5);
    });
  });

  describe("given no pairs", () => {
    it("returns zeroed counts and zero accuracy, not NaN", () => {
      const result = computeConfusionMatrix([]);
      expect(result).toMatchObject({
        truePositive: 0,
        falsePositive: 0,
        falseNegative: 0,
        trueNegative: 0,
        total: 0,
        accuracy: 0,
      });
    });

    it("returns null (not NaN) for every derived rate", () => {
      const result = computeConfusionMatrix([]);
      expect(result.precision).toBeNull();
      expect(result.recall).toBeNull();
      expect(result.f1).toBeNull();
      expect(result.falsePositiveRate).toBeNull();
    });
  });

  describe("when the judge never predicts positive", () => {
    const pairs: JudgeAnnotationPair[] = [
      { rowIndex: 0, predicted: false, actual: true },
      { rowIndex: 1, predicted: false, actual: false },
    ];

    it("returns null precision instead of dividing by zero", () => {
      expect(computeConfusionMatrix(pairs).precision).toBeNull();
    });

    it("still computes a defined recall", () => {
      expect(computeConfusionMatrix(pairs).recall).toBe(0);
    });
  });

  describe("when there is no actual positive in the ground truth", () => {
    const pairs: JudgeAnnotationPair[] = [
      { rowIndex: 0, predicted: true, actual: false },
      { rowIndex: 1, predicted: false, actual: false },
    ];

    it("returns null recall instead of dividing by zero", () => {
      expect(computeConfusionMatrix(pairs).recall).toBeNull();
    });

    it("returns null F1 when either precision or recall is null", () => {
      expect(computeConfusionMatrix(pairs).f1).toBeNull();
    });
  });

  describe("when every pair agrees perfectly", () => {
    const pairs: JudgeAnnotationPair[] = [
      { rowIndex: 0, predicted: true, actual: true },
      { rowIndex: 1, predicted: false, actual: false },
    ];

    it("reports 100% accuracy, precision, recall, and F1", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.accuracy).toBe(1);
      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
    });

    it("reports a 0% false positive rate", () => {
      expect(computeConfusionMatrix(pairs).falsePositiveRate).toBe(0);
    });
  });
});

/** Builds pairs matching an exact quadrant layout, for readable arrange steps. */
const pairsFromCounts = ({
  truePositive,
  falsePositive,
  falseNegative,
  trueNegative,
}: ConfusionMatrixCounts): JudgeAnnotationPair[] => {
  const quadrants: [number, boolean, boolean][] = [
    [truePositive, true, true],
    [falsePositive, true, false],
    [falseNegative, false, true],
    [trueNegative, false, false],
  ];
  let rowIndex = 0;
  return quadrants.flatMap(([count, predicted, actual]) =>
    Array.from({ length: count }, () => ({
      rowIndex: rowIndex++,
      predicted,
      actual,
    })),
  );
};

describe("wilsonInterval", () => {
  describe("given no trials", () => {
    it("returns null rather than an interval over nothing", () => {
      expect(wilsonInterval({ successes: 0, trials: 0 })).toBeNull();
    });
  });

  describe("given 8 successes out of 10", () => {
    it("matches the published Wilson score bounds", () => {
      const interval = wilsonInterval({ successes: 8, trials: 10 });
      expect(interval?.lower).toBeCloseTo(0.4901, 3);
      expect(interval?.upper).toBeCloseTo(0.9433, 3);
    });
  });

  describe("when every trial succeeded", () => {
    // The whole reason Wilson is used instead of the textbook Wald
    // interval: at p=1 Wald collapses to zero width and claims perfect
    // certainty from 5 samples. Wilson still admits the rate could
    // plausibly be as low as ~57%.
    it("does not claim certainty from a small perfect run", () => {
      const interval = wilsonInterval({ successes: 5, trials: 5 });
      expect(interval?.lower).toBeCloseTo(0.5655, 3);
      expect(interval?.upper).toBe(1);
    });
  });

  describe("when no trial succeeded", () => {
    it("stays within [0, 1] instead of going negative", () => {
      const interval = wilsonInterval({ successes: 0, trials: 5 });
      expect(interval?.lower).toBeCloseTo(0, 10);
      expect(interval!.lower).toBeGreaterThanOrEqual(0);
      expect(interval?.upper).toBeCloseTo(0.4345, 3);
    });
  });
});

describe("computeConfusionMatrix statistical honesty", () => {
  describe("given a small sample", () => {
    const pairs = pairsFromCounts({
      truePositive: 3,
      falsePositive: 1,
      falseNegative: 1,
      trueNegative: 3,
    });

    /** @scenario Accuracy is reported with the range it could plausibly be */
    it("reports an accuracy interval wide enough to show the sample is thin", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.accuracy).toBeCloseTo(0.75, 5);
      // 75% from 8 rows is anywhere from 41% to 93% — the point
      // estimate alone reads as far more settled than it is.
      expect(result.accuracyInterval?.lower).toBeCloseTo(0.4092, 3);
      expect(result.accuracyInterval?.upper).toBeCloseTo(0.9285, 3);
    });
  });

  describe("given no pairs at all", () => {
    it("returns no interval and no kappa", () => {
      const result = computeConfusionMatrix([]);
      expect(result.accuracyInterval).toBeNull();
      expect(result.cohensKappa).toBeNull();
      expect(result.prevalence).toBeNull();
    });
  });

  describe("when the judge always says pass and most rows really are passes", () => {
    // The failure this metric exists to catch: a judge that has learned
    // nothing still scores 90% accuracy purely off the base rate.
    const pairs = pairsFromCounts({
      truePositive: 9,
      falsePositive: 1,
      falseNegative: 0,
      trueNegative: 0,
    });

    it("scores high accuracy", () => {
      expect(computeConfusionMatrix(pairs).accuracy).toBeCloseTo(0.9, 5);
    });

    /** @scenario A judge that only matches the base rate scores zero agreement */
    it("scores zero kappa, exposing that accuracy as chance", () => {
      expect(computeConfusionMatrix(pairs).cohensKappa).toBeCloseTo(0, 5);
    });

    it("reports the prevalence that explains the inflated accuracy", () => {
      expect(computeConfusionMatrix(pairs).prevalence).toBeCloseTo(0.9, 5);
    });
  });

  describe("when judge and reviewer agree on every row", () => {
    it("scores kappa of 1", () => {
      const pairs = pairsFromCounts({
        truePositive: 5,
        falsePositive: 0,
        falseNegative: 0,
        trueNegative: 5,
      });
      expect(computeConfusionMatrix(pairs).cohensKappa).toBeCloseTo(1, 5);
    });
  });

  describe("when judge and reviewer disagree on every row", () => {
    it("scores negative kappa, meaning worse than guessing", () => {
      const pairs = pairsFromCounts({
        truePositive: 0,
        falsePositive: 5,
        falseNegative: 5,
        trueNegative: 0,
      });
      expect(computeConfusionMatrix(pairs).cohensKappa).toBeCloseTo(-1, 5);
    });
  });

  describe("when both judge and reviewer marked every row the same way", () => {
    // Chance agreement is 100%, so the correction divides by zero —
    // kappa genuinely is not defined here, and saying "1.0" would lie.
    /** @scenario Undefined agreement is reported as undefined, not as perfect */
    it("returns null kappa rather than a fabricated perfect score", () => {
      const pairs = pairsFromCounts({
        truePositive: 10,
        falsePositive: 0,
        falseNegative: 0,
        trueNegative: 0,
      });
      const result = computeConfusionMatrix(pairs);
      expect(result.accuracy).toBe(1);
      expect(result.cohensKappa).toBeNull();
    });
  });
});

describe("kappaAgreementLabel", () => {
  describe("given kappa values across the Landis & Koch bands", () => {
    it("labels each band", () => {
      expect(kappaAgreementLabel(-0.2)).toBe("none");
      expect(kappaAgreementLabel(0)).toBe("none");
      expect(kappaAgreementLabel(0.005)).toBe("slight");
      expect(kappaAgreementLabel(0.1)).toBe("slight");
      expect(kappaAgreementLabel(0.3)).toBe("fair");
      expect(kappaAgreementLabel(0.5)).toBe("moderate");
      expect(kappaAgreementLabel(0.7)).toBe("substantial");
      expect(kappaAgreementLabel(0.9)).toBe("almost perfect");
    });
  });
});
