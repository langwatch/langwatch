import { describe, expect, it } from "vitest";
import { evaluationRunDataSchema } from "~/server/app-layer/evaluations/types";
import { clickHouseFilters } from "../clickhouse";
import { availableFilters } from "../registry";

describe("evaluation filter requiresKey wiring", () => {
  describe("when evaluations.passed filter is configured", () => {
    it("references evaluators with has_passed data", () => {
      expect(availableFilters["evaluations.passed"].requiresKey?.filter).toBe(
        "evaluations.evaluator_id.has_passed",
      );
    });
  });

  describe("when evaluations.score filter is configured", () => {
    it("references evaluators with has_score data", () => {
      expect(availableFilters["evaluations.score"].requiresKey?.filter).toBe(
        "evaluations.evaluator_id.has_score",
      );
    });
  });

  describe("when evaluations.label filter is configured", () => {
    it("references evaluators with has_label data", () => {
      expect(availableFilters["evaluations.label"].requiresKey?.filter).toBe(
        "evaluations.evaluator_id.has_label",
      );
    });
  });

  describe("when new filter variants are defined", () => {
    it("defines evaluations.evaluator_id.has_passed", () => {
      expect(availableFilters["evaluations.evaluator_id.has_passed"].name).toBe(
        "Evaluators with Passed results",
      );
    });

    it("defines evaluations.evaluator_id.has_score", () => {
      expect(availableFilters["evaluations.evaluator_id.has_score"].name).toBe(
        "Evaluators with Score results",
      );
    });

    it("defines evaluations.evaluator_id.has_label", () => {
      expect(availableFilters["evaluations.evaluator_id.has_label"].name).toBe(
        "Evaluators with Label results",
      );
    });
  });

  describe("when existing filters are checked", () => {
    it("preserves evaluations.evaluator_id unchanged", () => {
      expect(availableFilters["evaluations.evaluator_id"].name).toBe(
        "Contains Evaluation",
      );
    });

    it("preserves evaluations.evaluator_id.guardrails_only unchanged", () => {
      expect(
        availableFilters["evaluations.evaluator_id.guardrails_only"].name,
      ).toBe("Contains Evaluation (guardrails only)");
    });
  });
});

describe("evaluations.state filter options", () => {
  const extractResults = clickHouseFilters["evaluations.state"]!.extractResults;
  const row = (field: string, count: number) => ({
    field,
    label: field,
    count: String(count),
  });

  describe("given ClickHouse returns no rows", () => {
    it("offers every canonical EvaluationStatus value, matching the schema enum", () => {
      // Pins the option list to evaluationRunDataSchema. If the enum changes,
      // this fails and forces a deliberate update to both places.
      const options = extractResults([]);

      expect(options.map((option) => option.field)).toEqual(
        evaluationRunDataSchema.shape.status.options,
      );
    });

    it("reports a zero count so a trigger can be configured before the first occurrence", () => {
      const options = extractResults([]);

      expect(options.every((option) => option.count === 0)).toBe(true);
    });
  });

  describe("given ClickHouse returns a non-canonical stored status", () => {
    it("drops the phantom value the trigger matcher could never match", () => {
      const options = extractResults([
        row("Error_Message", 7),
        row("error", 2),
      ]);

      expect(options.map((option) => option.field)).not.toContain(
        "Error_Message",
      );
    });

    it("still offers the canonical status alongside its observed count", () => {
      const options = extractResults([
        row("Error_Message", 7),
        row("error", 2),
      ]);

      expect(options).toContainEqual({
        field: "error",
        label: "error",
        count: 2,
      });
    });
  });

  describe("given ClickHouse returns counts for some statuses", () => {
    it("folds observed counts in and zero-fills the unseen statuses", () => {
      const options = extractResults([row("processed", 5)]);

      expect(
        Object.fromEntries(
          options.map((option) => [option.field, option.count]),
        ),
      ).toEqual({
        scheduled: 0,
        in_progress: 0,
        processed: 5,
        error: 0,
        skipped: 0,
      });
    });
  });
});
