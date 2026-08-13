/**
 * @vitest-environment node
 *
 * Turn configuration (maxTurns / minTurns) threading tests.
 * Verifies schema parsing and data-prefetcher mapping.
 *
 * @see specs/scenarios/scenario-editor.feature   (Turn Configuration ADR-015)
 * @see specs/scenarios/scenario-execution.feature (Turn Config Threading ADR-015)
 * @see docs/adr/015-scenario-turn-config-ui.md
 */
import { describe, expect, it, vi } from "vitest";
import { ChildProcessJobDataSchema, ScenarioConfigSchema } from "../types";

// ============================================================================
// Layer 1: ScenarioConfigSchema accepts turn fields
// ============================================================================

describe("ScenarioConfigSchema turn config", () => {
  const base = {
    id: "scen_1",
    name: "Test",
    situation: "User asks",
    criteria: ["polite"],
    labels: [],
  };

  /** @scenario "Run with maxTurns limits conversation length" */
  it("accepts maxTurns as an optional integer", () => {
    const result = ScenarioConfigSchema.safeParse({ ...base, maxTurns: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTurns).toBe(5);
    }
  });

  /** @scenario "Run with minTurns guarantees minimum conversation length" */
  it("accepts minTurns as an optional integer", () => {
    const result = ScenarioConfigSchema.safeParse({ ...base, minTurns: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minTurns).toBe(2);
    }
  });

  /** @scenario "Run with both turn fields applies both constraints" */
  it("accepts both maxTurns and minTurns together", () => {
    const result = ScenarioConfigSchema.safeParse({
      ...base,
      maxTurns: 5,
      minTurns: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTurns).toBe(5);
      expect(result.data.minTurns).toBe(2);
    }
  });

  /** @scenario "Run with no turn config uses SDK defaults" */
  it("parses without turn fields (backward compat)", () => {
    const result = ScenarioConfigSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTurns).toBeUndefined();
      expect(result.data.minTurns).toBeUndefined();
    }
  });
});

// ============================================================================
// Layer 2: ChildProcessJobDataSchema preserves turn fields end-to-end
// ============================================================================

describe("ChildProcessJobDataSchema turn config threading", () => {
  const basePayload = {
    context: {
      projectId: "proj_1",
      scenarioId: "scen_1",
      setId: "set_1",
      batchRunId: "batch_1",
    },
    scenario: {
      id: "scen_1",
      name: "Test",
      situation: "User asks",
      criteria: ["polite"],
      labels: [],
    },
    adapterData: {
      type: "workflow" as const,
      agentId: "agent_1",
      workflowId: "wf_1",
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      secrets: {},
    },
    nlpServiceUrl: "http://langwatch_nlp:5561",
    target: { type: "workflow" as const, referenceId: "agent_1" },
    telemetry: { endpoint: "http://app:5560", apiKey: "key" },
    modelParams: { api_key: "sk-test", model: "openai/gpt-5-mini" },
    simulatorModelParams: {
      api_key: "sk-test",
      model: "openai/gpt-5-mini",
    },
    judgeModelParams: { api_key: "sk-test", model: "openai/gpt-5-mini" },
  };

  it("preserves maxTurns through the serialization boundary", () => {
    const result = ChildProcessJobDataSchema.safeParse({
      ...basePayload,
      scenario: { ...basePayload.scenario, maxTurns: 5 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenario.maxTurns).toBe(5);
    }
  });

  it("preserves minTurns through the serialization boundary", () => {
    const result = ChildProcessJobDataSchema.safeParse({
      ...basePayload,
      scenario: { ...basePayload.scenario, minTurns: 3 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenario.minTurns).toBe(3);
    }
  });

  /** @scenario "In-flight job without turn config still parses" */
  it("still parses without turn fields (in-flight job compat)", () => {
    const result = ChildProcessJobDataSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Layer 3: fetchScenario maps turn fields from DB to ScenarioConfig
// ============================================================================

vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://langwatch_nlp:5561",
    LANGWATCH_ENDPOINT: "http://app:5560",
  },
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(),
}));

describe("fetchScenario turn config mapping", () => {
  it("maps maxTurns and minTurns from DB row to ScenarioConfig", async () => {
    const { prefetchScenarioData } = await import("../data-prefetcher");
    const { createMockDepsForTurnConfig } = await import(
      "./support/turn-config-helpers"
    );

    const deps = createMockDepsForTurnConfig({
      scenario: {
        id: "scen_1",
        name: "Test",
        situation: "User asks",
        criteria: ["polite"],
        labels: [],
        simulatorModel: null,
        judgeModel: null,
        maxTurns: 5,
        minTurns: 2,
      },
    });

    const result = await prefetchScenarioData(
      {
        projectId: "proj_1",
        scenarioId: "scen_1",
        setId: "set_1",
        batchRunId: "batch_1",
      },
      { type: "prompt", referenceId: "prompt_1" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenario.maxTurns).toBe(5);
      expect(result.data.scenario.minTurns).toBe(2);
    }
  });

  it("maps null turn fields as undefined", async () => {
    const { prefetchScenarioData } = await import("../data-prefetcher");
    const { createMockDepsForTurnConfig } = await import(
      "./support/turn-config-helpers"
    );

    const deps = createMockDepsForTurnConfig({
      scenario: {
        id: "scen_1",
        name: "Test",
        situation: "User asks",
        criteria: ["polite"],
        labels: [],
        simulatorModel: null,
        judgeModel: null,
        maxTurns: null,
        minTurns: null,
      },
    });

    const result = await prefetchScenarioData(
      {
        projectId: "proj_1",
        scenarioId: "scen_1",
        setId: "set_1",
        batchRunId: "batch_1",
      },
      { type: "prompt", referenceId: "prompt_1" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenario.maxTurns).toBeUndefined();
      expect(result.data.scenario.minTurns).toBeUndefined();
    }
  });
});
