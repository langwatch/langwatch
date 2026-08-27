import { describe, expect, it } from "vitest";
import {
  LlmModelNotSetError,
  studioClientEventSchema,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import {
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
  type WorkflowLlmParameterResolution,
} from "../src/ports/workflow.port";
import { StudioWorkflowEventEnricherService } from "../src/services/studio-workflow-event-enricher.service";

const projectId = "project-123";

class FakeProjectEnvironment extends WorkflowProjectEnvironmentPort {
  readonly projectIds: string[] = [];

  constructor(
    private readonly secrets: Record<string, string> = { OPENAI_API_KEY: "sk-abc123" },
  ) {
    super();
  }

  async get(input: {
    projectId: string;
  }): Promise<{ apiKey: string; secrets: Record<string, string> }> {
    this.projectIds.push(input.projectId);
    return {
      apiKey: "test-api-key",
      secrets: this.secrets,
    };
  }
}

class FakeLlmParameters extends WorkflowLlmParametersPort {
  readonly calls: Array<{ projectId: string; models: readonly string[] }> = [];

  constructor(private readonly resolution: Partial<WorkflowLlmParameterResolution> = {}) {
    super();
  }

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
) =>
  StudioWorkflowEventEnricherService.create({
    projectEnvironment,
    llmParameters,
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

  it("adds the project API key and decrypted secrets", async () => {
    const result = await createEnricher().enrich({ event: event(), projectId });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    expect(result.payload.workflow).toMatchObject({
      api_key: "test-api-key",
      project_id: projectId,
      secrets: { OPENAI_API_KEY: "sk-abc123" },
    });
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
      event: event([llmNode({ model: "openai/gpt-4o", maxTokens: 64 })]),
      projectId,
    });
    if (!("workflow" in result.payload)) throw new Error("expected workflow payload");

    const node = result.payload.workflow.nodes[0];
    if (!node) throw new Error("expected LLM node");
    expect(node.data.parameters?.[0]?.value).toMatchObject({
      model: "openai/gpt-4o",
      max_tokens: 64,
      litellm_params: { model: "openai/gpt-4o" },
    });
  });

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
        event: event([llmNode({ model: "openai/gpt-4o" })]),
        projectId,
      }),
    ).rejects.toThrow("Model provider not configured: openai");
  });
});
