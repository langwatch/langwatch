import { describe, expect, it } from "vitest";
import type { Evaluation } from "~/server/tracer/types";
import type { ClickHouseEvaluationRunRow } from "../evaluation-run.mappers";
import {
  mapClickHouseEvaluationToTraceEvaluation,
  mapEsEvaluationToTraceEvaluation,
  mapTraceEvaluationsToLegacyEvaluations,
} from "../evaluation-run.mappers";
import type { TraceEvaluation } from "../evaluation-run.types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseCHRow: ClickHouseEvaluationRunRow = {
  Id: "row-1",
  TenantId: "project-1",
  EvaluationId: "eval-001",
  Version: "1",
  EvaluatorId: "evaluator-1",
  EvaluatorType: "llm",
  EvaluatorName: "Accuracy",
  TraceId: "trace-1",
  IsGuardrail: 0,
  Status: "processed",
  Score: 0.95,
  Passed: 1,
  Label: "good",
  Details: "Looks correct",
  Error: null,
  ScheduledAt: "2024-01-15 10:30:00.000",
  StartedAt: "2024-01-15 10:30:01.000",
  CompletedAt: "2024-01-15 10:30:02.000",
  LastProcessedEventId: "event-1",
  UpdatedAt: "2024-01-15 10:30:02.000",
};

const baseEsEvaluation: Evaluation = {
  evaluation_id: "eval-001",
  evaluator_id: "evaluator-1",
  name: "Accuracy",
  type: "llm",
  is_guardrail: false,
  status: "processed",
  passed: true,
  score: 0.95,
  label: "good",
  details: "Looks correct",
  error: null,
  timestamps: {
    inserted_at: 1705312200000,
    started_at: 1705312201000,
    finished_at: 1705312202000,
  },
};

// ---------------------------------------------------------------------------
// mapClickHouseEvaluationToTraceEvaluation
// ---------------------------------------------------------------------------

describe("mapClickHouseEvaluationToTraceEvaluation", () => {
  it("maps PascalCase fields to camelCase", () => {
    const result = mapClickHouseEvaluationToTraceEvaluation(baseCHRow);

    expect(result.evaluationId).toBe("eval-001");
    expect(result.evaluatorId).toBe("evaluator-1");
    expect(result.evaluatorType).toBe("llm");
    expect(result.evaluatorName).toBe("Accuracy");
    expect(result.traceId).toBe("trace-1");
    expect(result.status).toBe("processed");
    expect(result.score).toBe(0.95);
    expect(result.label).toBe("good");
    expect(result.details).toBe("Looks correct");
    expect(result.error).toBeNull();
  });

  it("converts UInt8 IsGuardrail to boolean", () => {
    const guardrailRow = { ...baseCHRow, IsGuardrail: 1 };
    expect(
      mapClickHouseEvaluationToTraceEvaluation(guardrailRow).isGuardrail,
    ).toBe(true);

    expect(
      mapClickHouseEvaluationToTraceEvaluation(baseCHRow).isGuardrail,
    ).toBe(false);
  });

  it("converts UInt8 Passed=1 to true", () => {
    const result = mapClickHouseEvaluationToTraceEvaluation(baseCHRow);
    expect(result.passed).toBe(true);
  });

  it("converts UInt8 Passed=0 to false", () => {
    const failedRow = { ...baseCHRow, Passed: 0 };
    expect(mapClickHouseEvaluationToTraceEvaluation(failedRow).passed).toBe(
      false,
    );
  });

  it("converts null Passed to null", () => {
    const nullPassedRow = { ...baseCHRow, Passed: null };
    expect(
      mapClickHouseEvaluationToTraceEvaluation(nullPassedRow).passed,
    ).toBeNull();
  });

  it("parses DateTime64 strings to Unix milliseconds", () => {
    const result = mapClickHouseEvaluationToTraceEvaluation(baseCHRow);

    expect(result.timestamps.scheduledAt).toBe(
      new Date("2024-01-15 10:30:00.000").getTime(),
    );
    expect(result.timestamps.startedAt).toBe(
      new Date("2024-01-15 10:30:01.000").getTime(),
    );
    expect(result.timestamps.completedAt).toBe(
      new Date("2024-01-15 10:30:02.000").getTime(),
    );
  });

  it("handles null timestamps", () => {
    const nullTimestamps = {
      ...baseCHRow,
      ScheduledAt: null,
      StartedAt: null,
      CompletedAt: null,
    };
    const result = mapClickHouseEvaluationToTraceEvaluation(nullTimestamps);

    expect(result.timestamps.scheduledAt).toBeNull();
    expect(result.timestamps.startedAt).toBeNull();
    expect(result.timestamps.completedAt).toBeNull();
  });

  it("handles null Score", () => {
    const nullScore = { ...baseCHRow, Score: null };
    expect(
      mapClickHouseEvaluationToTraceEvaluation(nullScore).score,
    ).toBeNull();
  });

  it("handles null EvaluatorName", () => {
    const nullName = { ...baseCHRow, EvaluatorName: null };
    expect(
      mapClickHouseEvaluationToTraceEvaluation(nullName).evaluatorName,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapEsEvaluationToTraceEvaluation
// ---------------------------------------------------------------------------

describe("mapEsEvaluationToTraceEvaluation", () => {
  it("maps snake_case fields to camelCase", () => {
    const result = mapEsEvaluationToTraceEvaluation(
      baseEsEvaluation,
      "trace-1",
    );

    expect(result.evaluationId).toBe("eval-001");
    expect(result.evaluatorId).toBe("evaluator-1");
    expect(result.evaluatorType).toBe("llm");
    expect(result.evaluatorName).toBe("Accuracy");
    expect(result.traceId).toBe("trace-1");
    expect(result.isGuardrail).toBe(false);
    expect(result.status).toBe("processed");
    expect(result.score).toBe(0.95);
    expect(result.passed).toBe(true);
    expect(result.label).toBe("good");
    expect(result.details).toBe("Looks correct");
    expect(result.error).toBeNull();
  });

  it("maps ES timestamps to canonical format", () => {
    const result = mapEsEvaluationToTraceEvaluation(
      baseEsEvaluation,
      "trace-1",
    );

    expect(result.timestamps.scheduledAt).toBe(1705312200000);
    expect(result.timestamps.startedAt).toBe(1705312201000);
    expect(result.timestamps.completedAt).toBe(1705312202000);
  });

  it("extracts error message from ErrorCapture", () => {
    const withError: Evaluation = {
      ...baseEsEvaluation,
      error: { has_error: true, message: "something failed", stacktrace: [] },
    };
    const result = mapEsEvaluationToTraceEvaluation(withError, "trace-1");
    expect(result.error).toBe("something failed");
  });

  it("sets error to null when no error", () => {
    const result = mapEsEvaluationToTraceEvaluation(
      baseEsEvaluation,
      "trace-1",
    );
    expect(result.error).toBeNull();
  });

  it("defaults type to empty string when null", () => {
    const noType = { ...baseEsEvaluation, type: null };
    const result = mapEsEvaluationToTraceEvaluation(noType, "trace-1");
    expect(result.evaluatorType).toBe("");
  });

  it("handles null/undefined optional fields", () => {
    const minimal: Evaluation = {
      ...baseEsEvaluation,
      name: "",
      score: undefined,
      passed: undefined,
      label: undefined,
      details: undefined,
    };
    const result = mapEsEvaluationToTraceEvaluation(minimal, "trace-1");

    // name "" maps to "" (only null/undefined map to null via ??)
    expect(result.evaluatorName).toBe("");
    expect(result.score).toBeNull();
    expect(result.passed).toBeNull();
    expect(result.label).toBeNull();
    expect(result.details).toBeNull();
  });

  it("maps null name to null evaluatorName", () => {
    const noName: Evaluation = {
      ...baseEsEvaluation,
      name: undefined as unknown as string,
    };
    const result = mapEsEvaluationToTraceEvaluation(noName, "trace-1");
    expect(result.evaluatorName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapTraceEvaluationsToLegacyEvaluations
// ---------------------------------------------------------------------------

describe("mapTraceEvaluationsToLegacyEvaluations", () => {
  const traceEvaluation: TraceEvaluation = {
    evaluationId: "eval-001",
    evaluatorId: "evaluator-1",
    evaluatorType: "llm",
    evaluatorName: "Accuracy",
    traceId: "trace-1",
    isGuardrail: false,
    status: "processed",
    score: 0.95,
    passed: true,
    label: "good",
    details: "correct",
    error: null,
    timestamps: {
      scheduledAt: 1705312200000,
      startedAt: 1705312201000,
      completedAt: 1705312202000,
    },
  };

  it("converts TraceEvaluation back to legacy Evaluation format", () => {
    const result = mapTraceEvaluationsToLegacyEvaluations({
      "trace-1": [traceEvaluation],
    });

    const legacy = result["trace-1"]![0]!;
    expect(legacy.evaluation_id).toBe("eval-001");
    expect(legacy.evaluator_id).toBe("evaluator-1");
    expect(legacy.type).toBe("llm");
    expect(legacy.name).toBe("Accuracy");
    expect(legacy.is_guardrail).toBe(false);
    expect(legacy.status).toBe("processed");
    expect(legacy.score).toBe(0.95);
    expect(legacy.passed).toBe(true);
    expect(legacy.label).toBe("good");
    expect(legacy.details).toBe("correct");
  });

  it("maps timestamps back to legacy format", () => {
    const result = mapTraceEvaluationsToLegacyEvaluations({
      "trace-1": [traceEvaluation],
    });

    const legacy = result["trace-1"]![0]!;
    expect(legacy.timestamps.inserted_at).toBe(1705312200000);
    expect(legacy.timestamps.started_at).toBe(1705312201000);
    expect(legacy.timestamps.finished_at).toBe(1705312202000);
  });

  it("sets error to null when no error", () => {
    const result = mapTraceEvaluationsToLegacyEvaluations({
      "trace-1": [traceEvaluation],
    });

    expect(result["trace-1"]![0]!.error).toBeNull();
  });

  it("converts error string to ErrorCapture object", () => {
    const withError = { ...traceEvaluation, error: "something failed" };
    const result = mapTraceEvaluationsToLegacyEvaluations({
      "trace-1": [withError],
    });

    const legacy = result["trace-1"]![0]!;
    expect(legacy.error).toEqual({
      has_error: true,
      message: "something failed",
      stacktrace: [],
    });
  });

  it("defaults evaluatorName to empty string when null", () => {
    const noName = { ...traceEvaluation, evaluatorName: null };
    const result = mapTraceEvaluationsToLegacyEvaluations({
      "trace-1": [noName],
    });

    expect(result["trace-1"]![0]!.name).toBe("");
  });

  it("preserves grouping by trace ID", () => {
    const result = mapTraceEvaluationsToLegacyEvaluations({
      "trace-1": [traceEvaluation],
      "trace-2": [{ ...traceEvaluation, evaluationId: "eval-002" }],
    });

    expect(Object.keys(result)).toEqual(["trace-1", "trace-2"]);
    expect(result["trace-1"]).toHaveLength(1);
    expect(result["trace-2"]).toHaveLength(1);
  });

  it("handles empty input", () => {
    const result = mapTraceEvaluationsToLegacyEvaluations({});
    expect(result).toEqual({});
  });
});
