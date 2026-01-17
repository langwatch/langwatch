import { describe, expect, it } from "vitest";
import {
  EVALUATION_STATUS_COLORS,
  getStatusLabel,
  parseEvaluationResult,
} from "../evaluationResults";

describe("parseEvaluationResult", () => {
  describe("pending status", () => {
    it("returns pending for null", () => {
      expect(parseEvaluationResult(null)).toEqual({ status: "pending" });
    });

    it("returns pending for undefined", () => {
      expect(parseEvaluationResult(undefined)).toEqual({ status: "pending" });
    });

    it("returns pending for empty object with no meaningful data", () => {
      expect(parseEvaluationResult({})).toEqual({ status: "pending" });
    });
  });

  describe("running status", () => {
    it("returns running for string 'running'", () => {
      expect(parseEvaluationResult("running")).toEqual({ status: "running" });
    });

    it("returns running for object with status: 'running'", () => {
      expect(parseEvaluationResult({ status: "running" })).toEqual({
        status: "running",
      });
    });
  });

  describe("passed/failed status from boolean", () => {
    it("returns passed for true", () => {
      expect(parseEvaluationResult(true)).toEqual({ status: "passed" });
    });

    it("returns failed for false", () => {
      expect(parseEvaluationResult(false)).toEqual({ status: "failed" });
    });
  });

  describe("passed/failed status from object", () => {
    it("returns passed when passed=true", () => {
      expect(parseEvaluationResult({ passed: true })).toEqual({
        status: "passed",
      });
    });

    it("returns failed when passed=false", () => {
      expect(parseEvaluationResult({ passed: false })).toEqual({
        status: "failed",
      });
    });

    it("returns passed with score when both provided", () => {
      expect(parseEvaluationResult({ passed: true, score: 0.95 })).toEqual({
        status: "passed",
        score: 0.95,
      });
    });

    it("returns failed with score when both provided", () => {
      expect(parseEvaluationResult({ passed: false, score: 0.2 })).toEqual({
        status: "failed",
        score: 0.2,
      });
    });

    it("returns passed with label when both provided", () => {
      expect(parseEvaluationResult({ passed: true, label: "Good" })).toEqual({
        status: "passed",
        label: "Good",
      });
    });

    it("handles status: 'processed' with passed=true", () => {
      expect(
        parseEvaluationResult({ status: "processed", passed: true, score: 1 }),
      ).toEqual({
        status: "passed",
        score: 1,
      });
    });

    it("handles status: 'processed' with passed=false", () => {
      expect(
        parseEvaluationResult({ status: "processed", passed: false, score: 0 }),
      ).toEqual({
        status: "failed",
        score: 0,
      });
    });
  });

  describe("processed status (score-only, no pass/fail)", () => {
    it("returns processed when only score is provided (no passed)", () => {
      expect(parseEvaluationResult({ score: 0.75 })).toEqual({
        status: "processed",
        score: 0.75,
      });
    });

    it("returns processed when only label is provided (no passed)", () => {
      expect(parseEvaluationResult({ label: "neutral" })).toEqual({
        status: "processed",
        label: "neutral",
      });
    });

    it("returns processed when only details is provided (no passed)", () => {
      expect(parseEvaluationResult({ details: "some details" })).toEqual({
        status: "processed",
        details: "some details",
      });
    });

    it("returns processed when score and label provided but no passed", () => {
      expect(parseEvaluationResult({ score: 0.5, label: "Medium" })).toEqual({
        status: "processed",
        score: 0.5,
        label: "Medium",
      });
    });

    it("returns processed when passed is null", () => {
      expect(parseEvaluationResult({ passed: null, score: 0.8 })).toEqual({
        status: "processed",
        score: 0.8,
      });
    });

    it("returns processed when passed is undefined explicitly", () => {
      expect(parseEvaluationResult({ passed: undefined, score: 0.8 })).toEqual({
        status: "processed",
        score: 0.8,
      });
    });

    it("returns processed for status: 'processed' without passed field", () => {
      expect(
        parseEvaluationResult({ status: "processed", score: 0.6 }),
      ).toEqual({
        status: "processed",
        score: 0.6,
      });
    });
  });

  describe("error status", () => {
    it("returns error for object with error string", () => {
      expect(parseEvaluationResult({ error: "Something went wrong" })).toEqual({
        status: "error",
        details: "Something went wrong",
      });
    });

    it("returns error for object with error object (JSON stringified)", () => {
      expect(
        parseEvaluationResult({
          error: { code: 500, message: "Server error" },
        }),
      ).toEqual({
        status: "error",
        details: '{"code":500,"message":"Server error"}',
      });
    });

    it("returns error for status: 'error' format (backend format)", () => {
      expect(
        parseEvaluationResult({
          status: "error",
          error_type: "EvaluatorError",
          details: "Evaluator cannot be reached",
        }),
      ).toEqual({
        status: "error",
        details: "Evaluator cannot be reached",
      });
    });

    it("returns error for status: 'error' without details", () => {
      expect(
        parseEvaluationResult({
          status: "error",
          error_type: "EvaluatorError",
        }),
      ).toEqual({
        status: "error",
      });
    });

    it("prioritizes error property over other fields", () => {
      expect(
        parseEvaluationResult({
          error: "Error message",
          passed: true,
          score: 1.0,
        }),
      ).toEqual({
        status: "error",
        details: "Error message",
      });
    });

    it("does not treat empty error string as error", () => {
      // Empty string is falsy, so should not be treated as error
      expect(parseEvaluationResult({ error: "", score: 0.5 })).toEqual({
        status: "processed",
        score: 0.5,
      });
    });
  });

  describe("skipped status", () => {
    it("returns skipped for status: 'skipped'", () => {
      expect(parseEvaluationResult({ status: "skipped" })).toEqual({
        status: "skipped",
      });
    });

    it("returns skipped with details", () => {
      expect(
        parseEvaluationResult({
          status: "skipped",
          details: "Skipped due to missing input",
        }),
      ).toEqual({
        status: "skipped",
        details: "Skipped due to missing input",
      });
    });
  });

  describe("real-world backend formats", () => {
    it("handles successful evaluator result with passed=true", () => {
      const result = {
        status: "processed",
        passed: true,
        score: 0.95,
        label: "Excellent",
        details: "All criteria met",
      };
      expect(parseEvaluationResult(result)).toEqual({
        status: "passed",
        score: 0.95,
        label: "Excellent",
        details: "All criteria met",
      });
    });

    it("handles successful evaluator result with passed=false", () => {
      const result = {
        status: "processed",
        passed: false,
        score: 0.2,
        details: "Did not meet criteria",
      };
      expect(parseEvaluationResult(result)).toEqual({
        status: "failed",
        score: 0.2,
        details: "Did not meet criteria",
      });
    });

    it("handles score-only evaluator (no pass/fail judgment)", () => {
      // This is the user's case: evaluation.log with score but no passed
      const result = {
        status: "processed",
        score: 1,
        passed: null, // or undefined
      };
      expect(parseEvaluationResult(result)).toEqual({
        status: "processed",
        score: 1,
      });
    });

    it("handles evaluator error from backend", () => {
      // Backend format for errors
      const result = {
        status: "error",
        error_type: "EvaluatorError",
        details: "Evaluator cannot be reached",
        traceback: [],
      };
      expect(parseEvaluationResult(result)).toEqual({
        status: "error",
        details: "Evaluator cannot be reached",
      });
    });

    it("handles running evaluator during execution", () => {
      const result = { status: "running" };
      expect(parseEvaluationResult(result)).toEqual({
        status: "running",
      });
    });
  });
});

describe("EVALUATION_STATUS_COLORS", () => {
  it("has correct color for pending (gray)", () => {
    expect(EVALUATION_STATUS_COLORS.pending).toBe("gray.400");
  });

  it("has correct color for running (blue)", () => {
    expect(EVALUATION_STATUS_COLORS.running).toBe("blue.400");
  });

  it("has correct color for passed (green)", () => {
    expect(EVALUATION_STATUS_COLORS.passed).toBe("green.500");
  });

  it("has correct color for failed (red)", () => {
    expect(EVALUATION_STATUS_COLORS.failed).toBe("red.500");
  });

  it("has correct color for processed (blue - neutral)", () => {
    expect(EVALUATION_STATUS_COLORS.processed).toBe("blue.500");
  });

  it("has correct color for error (red)", () => {
    expect(EVALUATION_STATUS_COLORS.error).toBe("red.500");
  });

  it("has correct color for skipped (yellow)", () => {
    expect(EVALUATION_STATUS_COLORS.skipped).toBe("yellow.500");
  });
});

describe("getStatusLabel", () => {
  it("returns 'Pending' for pending", () => {
    expect(getStatusLabel("pending")).toBe("Pending");
  });

  it("returns 'Running' for running", () => {
    expect(getStatusLabel("running")).toBe("Running");
  });

  it("returns 'Passed' for passed", () => {
    expect(getStatusLabel("passed")).toBe("Passed");
  });

  it("returns 'Failed' for failed", () => {
    expect(getStatusLabel("failed")).toBe("Failed");
  });

  it("returns 'Processed' for processed", () => {
    expect(getStatusLabel("processed")).toBe("Processed");
  });

  it("returns 'Error' for error", () => {
    expect(getStatusLabel("error")).toBe("Error");
  });

  it("returns 'Skipped' for skipped", () => {
    expect(getStatusLabel("skipped")).toBe("Skipped");
  });
});
