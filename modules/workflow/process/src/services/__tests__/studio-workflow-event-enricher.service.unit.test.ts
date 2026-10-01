import type { MintRunKeyInput } from "@langwatch/api-key-contract";
import {
  LlmModelNotSetError,
  studioClientEventSchema,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  type WorkflowLlmParameters,
  type WorkflowProjectEnvironment,
  type WorkflowLlmParameterResolution,
} from "../../app/workflow.app.ts";
import { StudioWorkflowEventEnricherService } from "../studio-workflow-event-enricher.service.ts";

const projectId = "project-123";

class FakeProjectEnvironment implements WorkflowProjectEnvironment {
  readonly projectIds: string[] = [];

  constructor(private readonly secrets: Record<string, string> = { OPENAI_API_KEY: "sk-abc123" }) {}

  async get(input: { projectId: string }): Promise<{ secrets: Record<string, string> }> {
    this.projectIds.push(input.projectId);
    return { secrets: this.secrets };
  }
}

const DISPATCH_FLOOR_MS = 960_000;

class FakeRunKeys {
  readonly calls: MintRunKeyInput[] = [];

  async mintRunKey(input: MintRunKeyInput): Promise<string> {
    this.calls.push(input);

    return input.userId ? "minted-run-key" : "ownerless-run-key";
  }
}

class FakeLlmParameters implements WorkflowLlmParameters {
  readonly calls: { projectId: string; models: readonly string[] }[] = [];

  constructor(private readonly resolution: Partial<WorkflowLlmParameterResolution> = {}) {}

  async resolve(input: { projectId: string; models: readonly string[] }) {
    this.calls.push(input);
    return input.models.map((model) => ({
      model,
      provider: model.split("/")[0]!,
      configured: true,
      enabled: true,
      litellmParams: { model },
      ...this.resolution,
    }));
  }
}

const event = (nodes: unknown[] = []): StudioClientEvent =>
  studioClientEventSchema.parse({
    type: "execute_component",
    payload: {
      trace_id: "trace-1",
      workflow: {
        spec_version: "1.5",
        workflow_id: "workflow-1",
        name: "Test Workflow",
        icon: "test",
        description: "test",
        version: "1.0",
        nodes,
        edges: [],
        state: { execution: { status: "idle" } },
      },
      node_id: "node-1",
      inputs: {},
    },
  });

const llmNode = (value: unknown) => ({
  id: "llm_call",
  type: "signature",
  position: { x: 0, y: 0 },
  data: {
    name: "LLM Call",
    parameters: [{ identifier: "llm", type: "llm", value }],
  },
});

const createEnricher = (
  resolution: Partial<WorkflowLlmParameterResolution> = {},
  projectEnvironment = new FakeProjectEnvironment(),
  llmParameters = new FakeLlmParameters(resolution),
  runKeys = new FakeRunKeys(),
) =>
  StudioWorkflowEventEnricherService.create({
    projectEnvironment,
    llmParameters,
    runKeys,
    dispatchKeyFloorMs: DISPATCH_FLOOR_MS,
  });

describe("StudioWorkflowEventEnricherService", () => {
  it("returns non-workflow events unchanged without reading dependencies", async () => {
    const projectEnvironment = new FakeProjectEnvironment();
    const llmParameters = new FakeLlmParameters();
    const enricher = createEnricher({}, projectEnvironment, llmParameters);
    const input = studioClientEventSchema.parse({ type: "is_alive", payload: {} });

    const result = await enricher.enrich({ event: input, projectId });

    expect(result).toBe(input);
    expect(projectEnvironment.projectIds).toEqual([]);
    expect(llmParameters.calls).toEqual([]);
  });

  it("adds a minted run key and the decrypted secrets", async () => {
    const result = await createEnricher().enrich({ event: event(), projectId });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    expect(result.payload.workflow).toMatchObject({
      api_key: "ownerless-run-key",
      project_id: projectId,
      secrets: { OPENAI_API_KEY: "sk-abc123" },
    });
  });

  /** @scenario "A workflow run calls LangWatch with a key minted for that run, never the project key" */
  it("puts a key minted for the starter in the run, not the project key", async () => {
    const runKeys = new FakeRunKeys();
    const result = await createEnricher({}, undefined, undefined, runKeys).enrich({
      event: event(),
      projectId,
      principal: { userId: "user-1" },
    });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    expect(result.payload.workflow).toMatchObject({ api_key: "minted-run-key" });
    expect(runKeys.calls).toEqual([
      {
        userId: "user-1",
        projectId,
        permissions: ["traces:create"],
        minRemainingMs: DISPATCH_FLOOR_MS,
      },
    ]);
  });

  /** @scenario "A run started with a personal access token holds no more than that token" */
  it("names the key the starter called with, so the run's key holds no more than it", async () => {
    const runKeys = new FakeRunKeys();
    await createEnricher({}, undefined, undefined, runKeys).enrich({
      event: event(),
      projectId,
      principal: { userId: "user-1", callerApiKeyId: "pat-1" },
    });

    expect(runKeys.calls[0]).toMatchObject({ userId: "user-1", callerApiKeyId: "pat-1" });
  });

  /** @scenario "A workflow run calls LangWatch with a key minted for that run, never the project key" */
  it("asks for evaluations only when the graph has an evaluator node", async () => {
    const runKeys = new FakeRunKeys();
    const evaluatorNode = { id: "eval", type: "evaluator", position: { x: 0, y: 0 }, data: {} };
    await createEnricher({}, undefined, undefined, runKeys).enrich({
      event: studioClientEventSchema.parse({
        type: "execute_flow",
        payload: {
          trace_id: "trace-1",
          workflow: {
            spec_version: "1.5",
            workflow_id: "workflow-1",
            name: "Test Workflow",
            icon: "test",
            description: "test",
            version: "1.0",
            nodes: [evaluatorNode],
            edges: [],
            state: { execution: { status: "idle" } },
          },
          inputs: [{}],
        },
      }),
      projectId,
      principal: { userId: "user-1" },
    });

    expect(runKeys.calls[0]?.permissions).toEqual(["traces:create", "evaluations:manage"]);
  });

  /** @scenario "A run nobody started calls LangWatch with a project key holding only what it needs" */
  it("mints an ownerless key for a run that names nobody, never the project key", async () => {
    const runKeys = new FakeRunKeys();
    const result = await createEnricher({}, undefined, undefined, runKeys).enrich({
      event: event(),
      projectId,
    });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    expect(result.payload.workflow).toMatchObject({ api_key: "ownerless-run-key" });
    expect(runKeys.calls).toEqual([
      { userId: null, projectId, permissions: ["traces:create"], minRemainingMs: DISPATCH_FLOOR_MS },
    ]);
  });

  it("keeps empty project secrets", async () => {
    const result = await createEnricher({}, new FakeProjectEnvironment({})).enrich({
      event: event(),
      projectId,
    });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    expect(result.payload.workflow.secrets).toEqual({});
  });

  it("uses the requested project when loading multiple secrets", async () => {
    const projectEnvironment = new FakeProjectEnvironment({
      OPENAI_API_KEY: "sk-abc123",
      ANTHROPIC_API_KEY: "sk-def456",
    });
    const result = await createEnricher({}, projectEnvironment).enrich({
      event: event(),
      projectId: "project-456",
    });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    expect(projectEnvironment.projectIds).toEqual(["project-456"]);
    expect(result.payload.workflow.secrets).toEqual({
      OPENAI_API_KEY: "sk-abc123",
      ANTHROPIC_API_KEY: "sk-def456",
    });
  });

  it("normalizes a node-owned LLM config and adds LiteLLM parameters", async () => {
    const result = await createEnricher().enrich({
      event: event([llmNode({ model: "openai/gpt-5-mini", maxTokens: 64 })]),
      projectId,
    });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    const node = result.payload.workflow.nodes[0];
    if (!node) throw new Error("expected LLM node");
    expect(node.data.parameters?.[0]?.value).toMatchObject({
      model: "openai/gpt-5-mini",
      max_tokens: 64,
      litellm_params: { model: "openai/gpt-5-mini" },
    });
  });

  /** @scenario Running a workflow with a modelless LLM node is rejected as a fixable problem */
  it("rejects a node-owned LLM config without a model and names the node", async () => {
    await expect(
      createEnricher().enrich({ event: event([llmNode(undefined)]), projectId }),
    ).rejects.toThrow(LlmModelNotSetError);
    await expect(
      createEnricher().enrich({ event: event([llmNode(undefined)]), projectId }),
    ).rejects.toThrow('LLM node "LLM Call" has no model selected');
  });

  it("rejects a node-owned LLM config with an empty model", async () => {
    await expect(
      createEnricher().enrich({ event: event([llmNode({ model: "" })]), projectId }),
    ).rejects.toThrow('LLM node "LLM Call" has no model selected');
  });

  it("preserves provider configuration failures", async () => {
    await expect(
      createEnricher({ configured: false }).enrich({
        event: event([llmNode({ model: "openai/gpt-5-mini" })]),
        projectId,
      }),
    ).rejects.toThrow("Model provider not configured: openai");
  });
});
