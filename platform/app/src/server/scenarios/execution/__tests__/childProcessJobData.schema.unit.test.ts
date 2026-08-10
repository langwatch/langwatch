/**
 * @vitest-environment node
 *
 * Issue #6634's child-process serialization boundary. Every model-params
 * field is individually optional — workflow / code / http targets resolve no
 * adapter-role `modelParams`, and a job queued before the simulator/judge
 * split carries only `modelParams` — but the payload as a whole must still
 * yield a model for each role. The schema enforces that as a refinement, and
 * `selectRoleModelParams` applies the pre-split fallback, so
 * `scenario-child-process.ts` fails loudly with a named Zod error instead of
 * an opaque `undefined` crash three layers into model construction.
 *
 * These tests run the real parse and then the real selection, so a payload
 * that would break a straddling deploy cannot pass them.
 *
 * @see specs/scenarios/simulation-run-model-resolution.feature
 *   ("A job payload missing every model params field fails at schema
 *   parse", "An older job payload shape still parses and runs")
 */
import { describe, expect, it } from "vitest";

import { selectRoleModelParams } from "../job-model-params";
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
      // Both roles genuinely need a model. With no own params AND no
      // adapter-role params to fall back to, neither can be built — that
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

  describe("given a pre-split job payload carrying only the legacy modelParams", () => {
    // Frozen literal — exactly the shape a worker queued before the
    // simulator/judge split would have produced, with no simulatorModelParams
    // and no judgeModelParams at all. Queued jobs straddle a deploy, so this
    // is the payload a freshly-deployed child process actually meets.
    const legacyPayload = {
      ...basePayload,
      modelParams: litellmParams,
    };

    /** @scenario "An older job payload shape still parses and runs" */
    it("parses, and both the simulator and the judge fall back to it", () => {
      const result = ChildProcessJobDataSchema.safeParse(legacyPayload);
      expect(result.success).toBe(true);
      if (!result.success) {
        expect.fail("expected the legacy payload to parse");
        return;
      }

      // The payload genuinely carries neither split field — the fallback is
      // what makes the run possible, not a value the fixture smuggled in.
      expect(result.data.simulatorModelParams).toBeUndefined();
      expect(result.data.judgeModelParams).toBeUndefined();

      const roleModelParams = selectRoleModelParams(result.data);
      expect(roleModelParams.simulator).toEqual(litellmParams);
      expect(roleModelParams.judge).toEqual(litellmParams);
    });
  });

  describe("given a payload carrying its own simulator and judge model params", () => {
    it("selects each role's own params over the legacy fallback", () => {
      const splitPayload = {
        ...basePayload,
        modelParams: litellmParams,
        simulatorModelParams: { api_key: "sk-sim", model: "openai/sim-model" },
        judgeModelParams: { api_key: "sk-judge", model: "openai/judge-model" },
      };

      const result = ChildProcessJobDataSchema.safeParse(splitPayload);
      expect(result.success).toBe(true);
      if (!result.success) {
        expect.fail("expected the split payload to parse");
        return;
      }

      const roleModelParams = selectRoleModelParams(result.data);
      expect(roleModelParams.simulator.model).toBe("openai/sim-model");
      expect(roleModelParams.judge.model).toBe("openai/judge-model");
    });
  });
});
