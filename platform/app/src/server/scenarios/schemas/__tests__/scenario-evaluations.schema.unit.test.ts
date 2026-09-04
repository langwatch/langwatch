import { describe, expect, it } from "vitest";
import { Verdict } from "../../scenario-event.enums";
import {
  SCENARIO_EVALUATION_STATUSES,
  type ScenarioEvaluationResult,
  scenarioEvaluationResultSchema,
  scenarioResultsSchema,
} from "../event-schemas";

/**
 * The JSON shape of one evaluator result, exactly as the scenario framework
 * sends it. Copy this object verbatim when mirroring the schema elsewhere.
 */
const FULL_EVALUATION_RESULT_JSON = {
  evaluatorId: "ragas/sql_query_equivalence",
  name: "SQL Query Equivalence",
  status: "failed",
  required: true,
  passed: false,
  score: 0.25,
  label: "different",
  details: "The generated query filters on the wrong column.",
  cost: { currency: "USD", amount: 0.0012 },
  inputs: {
    output: "SELECT * FROM orders WHERE region = 'EU'",
    expected_output: "SELECT * FROM orders WHERE market = 'EU'",
  },
} as const;

/** The smallest result the schema accepts. */
const MINIMAL_EVALUATION_RESULT_JSON = {
  evaluatorId: "eval_123",
  name: "Answer quality",
  status: "scored",
  required: false,
} as const;

describe("scenarioEvaluationResultSchema", () => {
  describe("given an evaluation result with every field set", () => {
    /** @scenario "The evaluation result schema round-trips every field" */
    it("reads back every field as given", () => {
      const parsed = scenarioEvaluationResultSchema.parse(
        FULL_EVALUATION_RESULT_JSON,
      );

      expect(parsed).toEqual(FULL_EVALUATION_RESULT_JSON);
      expect(
        scenarioEvaluationResultSchema.parse(
          JSON.parse(JSON.stringify(parsed)),
        ),
      ).toEqual(FULL_EVALUATION_RESULT_JSON);
    });
  });

  describe("given a result that carries only the required fields", () => {
    it("parses and leaves the optional fields absent", () => {
      const parsed: ScenarioEvaluationResult =
        scenarioEvaluationResultSchema.parse(MINIMAL_EVALUATION_RESULT_JSON);

      expect(parsed).toEqual(MINIMAL_EVALUATION_RESULT_JSON);
      expect(parsed.passed).toBeUndefined();
      expect(parsed.score).toBeUndefined();
      expect(parsed.inputs).toBeUndefined();
    });
  });

  describe("given every status the schema names", () => {
    it("accepts each one and refuses any other", () => {
      for (const status of SCENARIO_EVALUATION_STATUSES) {
        expect(
          scenarioEvaluationResultSchema.safeParse({
            ...MINIMAL_EVALUATION_RESULT_JSON,
            status,
          }).success,
        ).toBe(true);
      }
      expect(
        scenarioEvaluationResultSchema.safeParse({
          ...MINIMAL_EVALUATION_RESULT_JSON,
          status: "pending",
        }).success,
      ).toBe(false);
    });
  });

  describe("given a result missing a required field", () => {
    it("refuses it", () => {
      const { required: _required, ...withoutRequired } =
        MINIMAL_EVALUATION_RESULT_JSON;
      expect(
        scenarioEvaluationResultSchema.safeParse(withoutRequired).success,
      ).toBe(false);
    });
  });
});

describe("scenarioResultsSchema", () => {
  describe("when results carry evaluations", () => {
    it("keeps them beside the verdict and criteria", () => {
      const parsed = scenarioResultsSchema.parse({
        verdict: Verdict.FAILURE,
        reasoning: "The SQL check failed.",
        metCriteria: ["Answers politely"],
        unmetCriteria: [],
        evaluations: [
          FULL_EVALUATION_RESULT_JSON,
          MINIMAL_EVALUATION_RESULT_JSON,
        ],
      });

      expect(parsed.evaluations).toEqual([
        FULL_EVALUATION_RESULT_JSON,
        MINIMAL_EVALUATION_RESULT_JSON,
      ]);
    });
  });

  describe("when results carry no evaluations", () => {
    it("still parses, as every result did before evaluators existed", () => {
      const parsed = scenarioResultsSchema.parse({
        verdict: Verdict.SUCCESS,
        metCriteria: [],
        unmetCriteria: [],
      });

      expect(parsed.evaluations).toBeUndefined();
    });
  });
});
