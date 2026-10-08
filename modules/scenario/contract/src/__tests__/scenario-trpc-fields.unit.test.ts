import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  INSTANT_EVAL_JUDGE_ONLY_MESSAGE,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { scenarioTrpcCreateSchema, scenarioTrpcUpdateSchema } from "../scenario.trpc.ts";

describe("the scenarios tRPC inputs", () => {
  describe("when a scenario is created with suite field values", () => {
    it("keeps the values for the save", () => {
      const parsed = scenarioTrpcCreateSchema.parse({
        projectId: "project-a",
        name: "Checkout",
        situation: "A customer checks out",
        fields: { golden_sql: "SELECT 1" },
      });

      expect(parsed.fields).toEqual({ golden_sql: "SELECT 1" });
    });
  });

  describe("when a scenario is updated with suite field values", () => {
    it("keeps the values for the save", () => {
      const parsed = scenarioTrpcUpdateSchema.parse({
        projectId: "project-a",
        id: "scenario-a",
        fields: { max_rows: 12 },
      });

      expect(parsed.fields).toEqual({ max_rows: 12 });
    });
  });

  describe.each([
    ["created", scenarioTrpcCreateSchema, { name: "Checkout", situation: "A customer checks out" }],
    ["updated", scenarioTrpcUpdateSchema, { id: "scenario-a" }],
  ] as const)("when a scenario is %s with a model override", (_action, schema, fields) => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it.each(["judgeModel", "simulatorModel"])("refuses Instant Evals as its %s", (key) => {
      const result = schema.safeParse({
        projectId: "project-a",
        ...fields,
        [key]: INSTANT_EVAL_JUDGE_MODEL_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(INSTANT_EVAL_JUDGE_ONLY_MESSAGE);
    });

    it("keeps a custom model id with a space, as the picker sends it", () => {
      const parsed = schema.parse({
        projectId: "project-a",
        ...fields,
        judgeModel: "custom/My Fine Tune",
      });

      expect(parsed.judgeModel).toBe("custom/My Fine Tune");
    });
  });
});
