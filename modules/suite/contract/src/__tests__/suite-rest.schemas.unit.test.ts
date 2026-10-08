/**
 * The wire schemas of the deprecated suites alias.
 * @see specs/api-reference/suites-legacy-alias.feature
 */

import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  INSTANT_EVAL_JUDGE_ONLY_MESSAGE,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { createSuiteInputSchema, runSuiteInputSchema } from "../suite-rest.schemas.ts";

const plan = {
  name: "Nightly Plan",
  scenarioIds: ["scenario_1"],
  targets: [{ type: "http", referenceId: "agent_1" }],
};

describe("createSuiteInputSchema", () => {
  describe("when the body carries fields the endpoint does not have", () => {
    it("refuses them by name instead of dropping them", () => {
      const result = createSuiteInputSchema.safeParse({
        ...plan,
        schedule: "0 2 * * *",
        cron: "0 2 * * *",
      });

      expect(result.success).toBe(false);
      const issue = result.error?.issues.find((one) => one.code === "unrecognized_keys");
      expect(issue).toMatchObject({ keys: ["schedule", "cron"] });
    });
  });

  describe("when the body carries only fields the endpoint has", () => {
    it("accepts a run plan", () => {
      expect(createSuiteInputSchema.validate(plan)).toBe(true);
    });

    it("accepts a test suite", () => {
      expect(createSuiteInputSchema.validate({ name: "Refunds", kind: "folder" })).toBe(true);
    });
  });
});

describe("runSuiteInputSchema", () => {
  /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
  it.each(["judgeModel", "simulatorModel"])("refuses Instant Evals as the run's %s", (key) => {
    const result = runSuiteInputSchema.safeParse({ [key]: INSTANT_EVAL_JUDGE_MODEL_ID });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INSTANT_EVAL_JUDGE_ONLY_MESSAGE);
  });

  it("keeps any other model", () => {
    expect(runSuiteInputSchema.safeParse({ judgeModel: "openai/gpt-5-mini" }).success).toBe(true);
  });
});
