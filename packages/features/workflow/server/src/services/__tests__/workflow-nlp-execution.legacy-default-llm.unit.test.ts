import { describe, expect, it, vi } from "vitest";
import {
  migrateDSLVersion,
  studioClientEventSchema,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import {
  WorkflowIdPort,
  WorkflowNlpRuntimePort,
  type WorkflowNlpDispatchInput,
  type WorkflowNlpDispatchResponse,
} from "../../ports/workflow.port";
import { WorkflowNlpExecutionService } from "../workflow-nlp-execution.service";
import { TestModelProviderService } from "./model-provider.service.fake";

class FixedWorkflowIdPort extends WorkflowIdPort {
  next(): string {
    return "generated";
  }
}

class TestWorkflowNlpRuntimePort extends WorkflowNlpRuntimePort {
  constructor(
    private readonly dispatchNlp: (
      input: WorkflowNlpDispatchInput,
    ) => Promise<WorkflowNlpDispatchResponse>,
  ) {
    super();
  }

  dispatch(input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse> {
    return this.dispatchNlp(input);
  }
}

describe("WorkflowNlpExecutionService with a migrated legacy version", () => {
  it("upgrades a pre-1.5 version before execution", () => {
    const migrated = migrateDSLVersion({
      spec_version: "1.4",
      workflow_id: "workflow_1",
      name: "Legacy published workflow",
      icon: "🧩",
      description: "",
      version: "1",
      template_adapter: "default",
      enable_tracing: true,
      default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
      state: {},
      nodes: [
        {
          id: "llm_call",
          type: "signature",
          position: { x: 0, y: 0 },
          data: {
            parameters: [{ identifier: "llm", type: "llm", value: null }],
          },
        },
      ],
      edges: [],
    });

    expect(migrated.spec_version).toBe("1.5");
    expect(migrated.nodes[0]?.data.parameters?.[0]?.value).toEqual({
      model: "openai/gpt-5-mini",
      max_tokens: 256,
    });
    expect("default_llm" in migrated).toBe(false);
  });

  it("dispatches the node-owned LLM configuration supplied by the migration boundary", async () => {
    const dispatchNlp = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ result: {}, status: "success" }),
    });
    const runtime = {
      ids: new FixedWorkflowIdPort(),
      modelProviders: new TestModelProviderService(),
      nlpRuntime: new TestWorkflowNlpRuntimePort(dispatchNlp),
    };
    const studioEvents = {
      enrich: async (event: { event: StudioClientEvent }) => event.event,
      prepare: async (event: { event: StudioClientEvent }) => event.event,
    };
    const executor = WorkflowNlpExecutionService.create({
      ...runtime,
      studioEvents,
    });

    await executor.execute({
      projectId: "project_1",
      workflowId: "workflow_1",
      inputs: {},
      version: {
        id: "version_1",
        workflowId: "workflow_1",
        projectId: "project_1",
        version: "1",
        autoSaved: false,
        commitMessage: "legacy publish",
        authorId: null,
        parentId: null,
        dsl: {
          spec_version: "1.4",
          workflow_id: "workflow_1",
          name: "Legacy published workflow",
          icon: "🧩",
          description: "",
          template_adapter: "default",
          enable_tracing: true,
          default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
          state: {},
          version: "1",
          nodes: [
            {
              id: "llm_call",
              type: "signature",
              position: { x: 0, y: 0 },
              data: {
                parameters: [{ identifier: "llm", type: "llm", value: null }],
              },
            },
          ],
          edges: [],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const event = studioClientEventSchema.parse(dispatchNlp.mock.calls[0]?.[0]?.body);
    if (event.type !== "execute_flow") {
      throw new Error("Expected an execute_flow event.");
    }

    const signature = event.payload.workflow.nodes.find((node) => node.type === "signature");
    const llm = signature?.data.parameters?.find((parameter) => parameter.type === "llm")?.value;

    expect(llm).toEqual({ model: "openai/gpt-5-mini", max_tokens: 256 });
  });
});
