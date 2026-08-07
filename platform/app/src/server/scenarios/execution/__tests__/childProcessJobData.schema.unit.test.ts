/**
 * @vitest-environment node
 *
 * Issue #6634's child-process serialization boundary flip: `modelParams`
 * (the agent-under-test's model) becomes OPTIONAL — workflow / code / http
 * targets never resolve one — while `simulatorModelParams` and
 * `judgeModelParams` become NON-optional going forward, since every run
 * genuinely needs both. `scenario-child-process.ts` must validate the
 * payload against `ChildProcessJobDataSchema` (a real `.parse()`, not the
 * unchecked type cast it uses today) so a malformed payload fails loudly
 * with a named Zod error instead of an opaque `undefined` crash three
 * layers into model construction.
 *
 * @see specs/scenarios/simulation-run-model-resolution.feature
 *   ("A job payload missing every model params field fails at schema
 *   parse", "An older job payload shape still parses and runs")
 */
import { describe, expect, it } from "vitest";

import { ChildProcessJobDataSchema, type LiteLLMParams } from "../types";

const scenario = {
  id: "scen_1",
  name: "Test Scenario",
  situation: "User asks a question",
  criteria: ["Responds politely"],
  labels: [],
};

const context = {
  projectId: "proj_1",
  scenarioId: "scen_1",
  setId: "set_1",
  batchRunId: "batch_1",
};

const workflowAdapterData = {
  type: "workflow" as const,
  agentId: "agent_1",
  workflowId: "wf_1",
  workflow: { nodes: [], edges: [] },
  inputs: [],
  outputs: [],
  secrets: {},
};

const litellmParams: LiteLLMParams = {
  api_key: "sk-test",
  model: "openai/gpt-5-mini",
};

const basePayload = {
  context,
  scenario,
  adapterData: workflowAdapterData,
  nlpServiceUrl: "http://langwatch_nlp:5561",
  target: { type: "workflow" as const, referenceId: "agent_1" },
};

describe("ChildProcessJobDataSchema", () => {
  describe("given a payload with no model params at all", () => {
    /** @scenario "A job payload missing every model params field fails at schema parse" */
    it("fails to parse", () => {
      const result = ChildProcessJobDataSchema.safeParse(basePayload);
      expect(result.success).toBe(false);
    });

    it("names the missing fields in the parse error", () => {
      const result = ChildProcessJobDataSchema.safeParse(basePayload);
      if (result.success) {
        expect.fail("expected parsing to fail");
        return;
      }
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      // Both roles genuinely need a model — a payload missing them both
      // must be caught here, not three call frames deeper as an
      // "undefined has no properties" crash.
      expect(paths).toEqual(
        expect.arrayContaining(["simulatorModelParams", "judgeModelParams"]),
      );
    });
  });

  describe("given a payload with only simulator and judge model params (no adapter model)", () => {
    /** @scenario "A workflow target resolves no adapter-role model" */
    it("parses successfully — modelParams is optional", () => {
      const result = ChildProcessJobDataSchema.safeParse({
        ...basePayload,
        simulatorModelParams: litellmParams,
        judgeModelParams: litellmParams,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("given a frozen, already-in-flight job payload (all three model params present)", () => {
    /** @scenario "An older job payload shape still parses and runs" */
    it("still parses under the new schema", () => {
      // Frozen literal — exactly the shape a worker queued just before
      // #6634 shipped would have produced (modelParams was mandatory;
      // simulatorModelParams/judgeModelParams were already being written
      // but were still optional on the reading side). It must never stop
      // parsing once simulatorModelParams/judgeModelParams flip to
      // mandatory on the reading side — a payload that already carries
      // both satisfies that requirement trivially.
      const oldShapePayload = {
        context,
        scenario,
        adapterData: workflowAdapterData,
        modelParams: litellmParams,
        simulatorModelParams: { api_key: "sk-sim", model: "openai/sim-model" },
        judgeModelParams: { api_key: "sk-judge", model: "openai/judge-model" },
        nlpServiceUrl: "http://langwatch_nlp:5561",
        target: { type: "workflow" as const, referenceId: "agent_1" },
      };

      const result = ChildProcessJobDataSchema.safeParse(oldShapePayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelParams).toEqual(litellmParams);
        expect(result.data.simulatorModelParams?.model).toBe(
          "openai/sim-model",
        );
        expect(result.data.judgeModelParams?.model).toBe("openai/judge-model");
      }
    });
  });
});
