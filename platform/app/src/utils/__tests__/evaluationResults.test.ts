import { describe, expect, it } from "vitest";
import {
  EVALUATION_STATUS_COLORS,
  EVALUATION_STATUS_TONES,
  getEvalChipDisplay,
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

    describe("given a domainError payload", () => {
      it("parses a full current-shape payload", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: {
            code: "evaluator_execution_error",
            httpStatus: 401,
            meta: { httpStatus: 401 },
            traceId: "trace-1",
            spanId: "span-1",
            traceUrl: "https://grafana.example.com/trace-1",
            reasons: [{ code: "invalid_api_key", kind: "invalid_api_key" }],
          },
        });

        expect(result.domainError).toEqual({
          code: "evaluator_execution_error",
          kind: "evaluator_execution_error",
          httpStatus: 401,
          fault: "customer",
          meta: { httpStatus: 401 },
          traceId: "trace-1",
          spanId: "span-1",
          traceUrl: "https://grafana.example.com/trace-1",
          reasons: [{ code: "invalid_api_key", kind: "invalid_api_key" }],
        });
      });

      it("derives code from a legacy kind-only payload", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: { kind: "evaluator_execution_error", httpStatus: 401 },
        });

        expect(result.domainError).toEqual({
          code: "evaluator_execution_error",
          kind: "evaluator_execution_error",
          httpStatus: 401,
          fault: "customer",
          meta: {},
          traceId: undefined,
          spanId: undefined,
          traceUrl: undefined,
          reasons: [],
        });
      });

      it("derives kind from a code-only payload", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: { code: "evaluator_execution_error", httpStatus: 401 },
        });

        expect(result.domainError?.kind).toBe("evaluator_execution_error");
      });

      it("preserves fault, tips and docsUrl through the parse", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: {
            code: "evaluator_execution_error",
            httpStatus: 502,
            fault: "provider",
            tips: ["Check the evaluator logs"],
            docsUrl: "https://docs.langwatch.ai/evaluations",
            reasons: [
              {
                code: "rate_limited",
                kind: "rate_limited",
                tips: ["Back off"],
              },
            ],
          },
        });

        expect(result.domainError).toMatchObject({
          fault: "provider",
          tips: ["Check the evaluator logs"],
          docsUrl: "https://docs.langwatch.ai/evaluations",
          reasons: [{ code: "rate_limited", tips: ["Back off"] }],
        });
      });

      it("drops the domainError when httpStatus is missing", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: { code: "evaluator_execution_error" },
        });

        expect(result.domainError).toBeUndefined();
      });

      it("drops the domainError when neither code nor kind is present", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: { httpStatus: 401 },
        });

        expect(result.domainError).toBeUndefined();
      });

      it("drops a non-object domainError", () => {
        const result = parseEvaluationResult({
          status: "error",
          domainError: "not an object",
        });

        expect(result.domainError).toBeUndefined();
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
  // A raw palette shade (gray.400, red.600) is one fixed value, so a status dot
  // written that way reads correctly in one colour mode and disappears in the
  // other. Every entry has to be a semantic token, which carries both.
  // Enforced repo-wide by cmd/semantictokens.
  it("gives every status a semantic token rather than a raw palette shade", () => {
    for (const [status, color] of Object.entries(EVALUATION_STATUS_COLORS)) {
      expect(color, `${status} should not be a raw shade`).not.toMatch(
        /\.\d{2,3}$/,
      );
    }
  });

  it("keeps error visually distinct from fail, so a broken evaluator does not read as a verdict", () => {
    expect(EVALUATION_STATUS_COLORS.error).not.toBe(
      EVALUATION_STATUS_COLORS.failed,
    );
  });

  it("keeps skipped distinct from pending — one is a setup state, the other is in flight", () => {
    expect(EVALUATION_STATUS_COLORS.skipped).not.toBe(
      EVALUATION_STATUS_COLORS.pending,
    );
  });

  it("pairs each tone's foreground with a semantic token too", () => {
    for (const [status, tone] of Object.entries(EVALUATION_STATUS_TONES)) {
      expect(tone.fg, `${status} fg should not be a raw shade`).not.toMatch(
        /\.\d{2,3}$/,
      );
      expect(tone.bg, `${status} bg should not be a raw shade`).not.toMatch(
        /\.\d{2,3}$/,
      );
    }
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

describe("getEvalChipDisplay", () => {
  describe("when adapting the trace-list status enum", () => {
    it("normalizes processed + passed=true to passed", () => {
      const d = getEvalChipDisplay({
        status: "processed",
        passed: true,
        score: null,
      });
      expect(d.status).toBe("passed");
      expect(d.color).toBe(EVALUATION_STATUS_COLORS.passed);
      expect(d.passLabel).toEqual({ text: "Pass", color: "green.fg" });
    });

    it("normalizes processed + passed=false to failed", () => {
      const d = getEvalChipDisplay({
        status: "processed",
        passed: false,
        score: null,
      });
      expect(d.status).toBe("failed");
      expect(d.passLabel).toEqual({ text: "Fail", color: "red.fg" });
    });

    it("normalizes the v1 'pass' / 'fail' tokens", () => {
      expect(getEvalChipDisplay({ status: "pass" }).status).toBe("passed");
      expect(getEvalChipDisplay({ status: "fail" }).status).toBe("failed");
    });

    it("normalizes the trace-list 'in_progress' / 'scheduled' tokens", () => {
      expect(getEvalChipDisplay({ status: "in_progress" }).status).toBe(
        "running",
      );
      expect(getEvalChipDisplay({ status: "scheduled" }).status).toBe(
        "pending",
      );
    });

    it("maps the legacy 'warning' status to failed so the chip turns red", () => {
      expect(getEvalChipDisplay({ status: "warning" }).status).toBe("failed");
    });
  });

  describe("when rendering trailing verdict slot", () => {
    it("yields numeric scoreText for numeric verdicts (<= 1)", () => {
      expect(
        getEvalChipDisplay({ status: "processed", score: 0.75 }).scoreText,
      ).toBe("0.75");
    });

    it("yields one-decimal scoreText for verdicts > 1", () => {
      expect(
        getEvalChipDisplay({ status: "processed", score: 5 }).scoreText,
      ).toBe("5.0");
    });

    it("suppresses the boolean Pass/Fail label when a numeric score exists", () => {
      const d = getEvalChipDisplay({ status: "passed", score: 0.9 });
      expect(d.scoreText).toBe("0.90");
      expect(d.passLabel).toBeNull();
    });

    it("marks skipped + error as no-verdict so the dot is dropped", () => {
      expect(getEvalChipDisplay({ status: "skipped" }).noVerdict).toBe(true);
      expect(getEvalChipDisplay({ status: "error" }).noVerdict).toBe(true);
    });
  });

  describe("when picking a display name", () => {
    it("prefers explicit name over evaluatorId", () => {
      expect(
        getEvalChipDisplay({ name: "Safety", evaluatorId: "azure_safety" })
          .displayName,
      ).toBe("Safety");
    });

    it("falls back to evaluatorId when name missing", () => {
      expect(
        getEvalChipDisplay({ evaluatorId: "azure_safety" }).displayName,
      ).toBe("azure_safety");
    });

    it("accepts the trace-list shape (evaluatorName) as an alias for name", () => {
      // The trace-list `TraceEvalResult` uses `evaluatorName` (matches the
      // ClickHouse column) while the drawer header chip passes `name`.
      // Both shapes need to resolve to the same displayName — otherwise the
      // trace-list EVALS column falls back to the monitor's KSUID and
      // operators see `monitor_xxxx…` instead of the real evaluator name.
      // Regression for the customer report on the v2 trace list.
      expect(
        getEvalChipDisplay({
          evaluatorName: "User frustration by input",
          evaluatorId: "monitor_ZAnGKUxsvjLf6PnAFzvws",
        }).displayName,
      ).toBe("User frustration by input");
    });

    it("prefers `name` over `evaluatorName` when both are present", () => {
      // `name` wins so callers can explicitly override the persisted name
      // without us having to chase down every adapter.
      expect(
        getEvalChipDisplay({
          name: "Safety",
          evaluatorName: "azure/content_safety",
          evaluatorId: "monitor_x",
        }).displayName,
      ).toBe("Safety");
    });
  });

  it("color tokens stay in lockstep with EVALUATION_STATUS_COLORS for every status", () => {
    for (const [status, color] of Object.entries(EVALUATION_STATUS_COLORS)) {
      const d = getEvalChipDisplay({ status });
      expect(d.color).toBe(color);
      expect(d.statusLabel).toBe(getStatusLabel(d.status));
    }
  });

  describe("given a categorising evaluator that answered with a label only", () => {
    // A categorising evaluator classifies rather than judges. Its runs reach
    // the UI with a `processed`/`pass` status and, from some adapters, a
    // score of 0 — both stand-ins for fields it never filled.
    describe("when getEvalChipDisplay formats the result", () => {
      /** @scenario A category verdict leads the card header */
      it("reports the category as the verdict when the caller knows its scoreType", () => {
        const d = getEvalChipDisplay({
          name: "Max conversation outcome",
          status: "processed",
          scoreType: "categorical",
          score: 0,
          label: "resolved",
          passed: null,
        });

        expect(d.categoryLabel).toBe("resolved");
        // The zero is a stand-in, so it must not reach the chip as a score.
        expect(d.scoreText).toBeNull();
        expect(d.passLabel).toBeNull();
      });

      /** @scenario A category verdict leads the card header */
      it("infers the category for a caller that carries no scoreType", () => {
        // The trace-list payload has no scoreType; an absent score and an
        // absent verdict beside a label say the same thing.
        const d = getEvalChipDisplay({
          evaluatorName: "Max conversation outcome",
          status: "processed",
          score: null,
          label: "resolved",
          passed: null,
        });

        expect(d.categoryLabel).toBe("resolved");
        expect(d.passLabel).toBeNull();
      });
    });
  });

  describe("given an evaluator that produced a real verdict", () => {
    describe("when getEvalChipDisplay formats the result", () => {
      /** @scenario A label alongside a real verdict rides next to the badge */
      it("keeps the score and reports no category when a label accompanies it", () => {
        const d = getEvalChipDisplay({
          name: "Toxicity",
          status: "processed",
          scoreType: "numeric",
          score: 0.9,
          label: "safe",
          passed: true,
        });

        expect(d.categoryLabel).toBeNull();
        expect(d.scoreText).toBe("0.90");
      });

      /** @scenario A label alongside a real verdict rides next to the badge */
      it("keeps the Pass label when a boolean verdict carries a label", () => {
        const d = getEvalChipDisplay({
          name: "Guardrail",
          status: "processed",
          score: null,
          label: "safe",
          passed: true,
        });

        expect(d.categoryLabel).toBeNull();
        expect(d.passLabel).toEqual({ text: "Pass", color: "green.fg" });
      });

      /** @scenario A label alongside a real verdict rides next to the badge */
      it("reads a labelled boolean score as a verdict rather than a category", () => {
        // A boolean IS the verdict, whatever it is labelled, so the label
        // rides beside a Pass rather than replacing it.
        const d = getEvalChipDisplay({
          name: "Guardrail",
          status: "passed",
          score: true,
          label: "safe",
        });

        expect(d.categoryLabel).toBeNull();
        expect(d.passLabel).toEqual({ text: "Pass", color: "green.fg" });
      });

      /** @scenario An evaluator with no label is unchanged */
      it("reports no category for an evaluator that produced none", () => {
        const d = getEvalChipDisplay({
          name: "Topic Adherence",
          status: "processed",
          scoreType: "numeric",
          score: 8.2,
        });

        expect(d.categoryLabel).toBeNull();
        expect(d.scoreText).toBe("8.2");
      });
    });
  });

  describe("given a categorising evaluator that never ran", () => {
    describe("when getEvalChipDisplay formats the result", () => {
      it("reports no category for a skipped run, whose label is not a verdict", () => {
        const d = getEvalChipDisplay({
          name: "Max conversation outcome",
          status: "skipped",
          scoreType: "categorical",
          label: "resolved",
          passed: null,
        });

        expect(d.categoryLabel).toBeNull();
        expect(d.noVerdict).toBe(true);
      });
    });
  });
});
