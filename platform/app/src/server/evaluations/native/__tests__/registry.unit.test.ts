import { describe, expect, it } from "vitest";
import type { SingleEvaluationResult } from "../../evaluators";
import { augmentEvaluationResult } from "../registry";

const PII = "presidio/pii_detection";
const SECRETS = "langwatch/api_keys_and_secrets_detection";

const augment = (params: {
  evaluatorType: string;
  mappedData: Record<string, unknown>;
  settings?: Record<string, unknown>;
  droppedCategories?: string[];
  result: SingleEvaluationResult;
}) =>
  augmentEvaluationResult({
    settings: undefined,
    droppedCategories: [],
    ...params,
  });

const passed: SingleEvaluationResult = {
  status: "processed",
  score: 0,
  passed: true,
};

describe("augmentEvaluationResult", () => {
  describe("given the PII detector and content redacted at ingestion", () => {
    /** @scenario PII redacted at ingestion still fails the PII detector */
    it("flags an enabled-entity marker that the live pass could not see", () => {
      const result = augment({
        evaluatorType: PII,
        mappedData: { input: "reach me at [EMAIL_ADDRESS] or [PHONE_NUMBER]" },
        settings: { entities: { email_address: true, phone_number: true } },
        result: passed,
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(false);
      expect(result.score).toBe(2);
      expect(result.details).toMatch(/redacted at ingestion/i);
    });

    /** @scenario A redacted entity the evaluator is not checking is ignored */
    it("ignores a marker for an entity the evaluator is not checking", () => {
      const result = augment({
        evaluatorType: PII,
        mappedData: { input: "from [IP_ADDRESS] today" },
        settings: { entities: { email_address: true, ip_address: false } },
        result: passed,
      });
      expect(result).toEqual(passed);
    });

    it("does not count a [SECRET] marker as PII", () => {
      const result = augment({
        evaluatorType: PII,
        mappedData: { input: "authorization: [SECRET]" },
        settings: { entities: { email_address: true } },
        result: passed,
      });
      expect(result).toEqual(passed);
    });
  });

  describe("given the secrets detector and a redacted secret", () => {
    /** @scenario A secret already redacted at ingestion is still flagged */
    it("flags a [SECRET] marker on top of the live result", () => {
      const result = augment({
        evaluatorType: SECRETS,
        mappedData: { input: "header authorization: [SECRET] end" },
        result: passed,
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(false);
      expect(result.score).toBe(1);
    });
  });

  describe("given content was dropped at ingestion", () => {
    /** @scenario Dropped content fails the detector */
    it("fails when nothing is left to check", () => {
      const result = augment({
        evaluatorType: PII,
        mappedData: { input: "", output: "" },
        droppedCategories: ["input", "output"],
        result: { status: "skipped", details: "empty" },
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(false);
      expect(result.score).toBe(1);
      expect(result.details).toMatch(/dropped at ingestion/i);
    });

    /** @scenario A populated mapped field is not failed by a dropped sibling */
    it("does not fail on drop when another mapped field still has content", () => {
      const result = augment({
        evaluatorType: PII,
        mappedData: { input: "", "app.note": "clean attribute content" },
        droppedCategories: ["input"],
        result: passed,
      });
      expect(result).toEqual(passed);
    });
  });

  describe("given a genuinely empty trace with no drop", () => {
    it("leaves the result untouched", () => {
      const result = augment({
        evaluatorType: PII,
        mappedData: { input: "" },
        droppedCategories: [],
        result: passed,
      });
      expect(result).toEqual(passed);
    });
  });

  describe("given an error result", () => {
    /** @scenario An evaluation error is never rewritten by the augmenter */
    it("never touches it (operational failures stay visible)", () => {
      const error: SingleEvaluationResult = {
        status: "error",
        error_type: "X",
        details: "boom",
        traceback: [],
      };
      const result = augment({
        evaluatorType: SECRETS,
        mappedData: { input: "authorization: [SECRET]" },
        result: error,
      });
      expect(result).toEqual(error);
    });
  });

  describe("given an evaluator that is not augmentable", () => {
    it("returns the result unchanged", () => {
      const result = augment({
        evaluatorType: "langevals/llm_boolean",
        mappedData: { input: "[EMAIL_ADDRESS]" },
        result: passed,
      });
      expect(result).toEqual(passed);
    });
  });
});
