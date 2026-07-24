import { describe, expect, it } from "vitest";
import {
  computeConfusionMatrix,
  type JudgeAnnotationPair,
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

    it("counts each quadrant correctly", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.truePositive).toBe(5);
      expect(result.falsePositive).toBe(1);
      expect(result.falseNegative).toBe(2);
      expect(result.trueNegative).toBe(4);
      expect(result.total).toBe(12);
    });

    it("computes accuracy as (TP + TN) / total", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.accuracy).toBeCloseTo(9 / 12, 5);
    });

    it("computes precision as TP / (TP + FP)", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.precision).toBeCloseTo(5 / 6, 5);
    });

    it("computes recall as TP / (TP + FN)", () => {
      const result = computeConfusionMatrix(pairs);
      expect(result.recall).toBeCloseTo(5 / 7, 5);
    });

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
