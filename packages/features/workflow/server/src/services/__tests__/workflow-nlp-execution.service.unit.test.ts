import { describe, expect, it, vi } from "vitest";
import { modelProviderSummarySchema } from "@langwatch/model-provider-contract";
import {
  llmConfigSchema,
  studioClientEventSchema,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import { z } from "zod";
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

const input = {
  projectId: "project_1",
  workflowId: "workflow_1",
  inputs: { ticket: "42", trace_id: "trace_generated" },
  version: {
    id: "version_1",
    workflowId: "workflow_1",
    projectId: "project_1",
    version: "1",
    autoSaved: false,
    commitMessage: "first",
    authorId: null,
    parentId: null,
    dsl: {
      spec_version: "1.5",
      workflow_id: "workflow_1",
      name: "Triage",
      icon: "",
      description: "",
      version: "1",
      nodes: [],
      edges: [],
      state: {},
      template_adapter: "default",
      enable_tracing: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe("WorkflowNlpExecutionService", () => {
  it("dispatches the already-resolved version without a persistence dependency", async () => {
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

    const result = await WorkflowNlpExecutionService.create({
      ...runtime,
      studioEvents,
    }).execute(input);

    expect(result).toEqual({ result: {}, status: "success" });
    expect(dispatchNlp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        origin: "workflow",
        body: expect.objectContaining({
          payload: expect.objectContaining({ trace_id: "trace_generated" }),
        }),
      }),
    );
  });

  it("removes unsupported parameters from root and parameter LLM slots", async () => {
    const dispatchNlp = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ result: {}, status: "success" }),
    });
    const provider = modelProviderSummarySchema.parse({
      id: "provider_1",
      organizationId: "organization_1",
      provider: "openai",
      name: "OpenAI",
      enabled: true,
      routingHandle: null,
      scopes: [],
      customKeys: {},
      customModels: [
        {
          id: "custom-model",
          label: "Custom model",
          type: "chat",
          supportedParameters: ["temperature"],
        },
      ],
      customEmbeddingsModels: [],
      extraHeaders: [],
      rateLimitRpm: null,
      rateLimitTpm: null,
      rateLimitRpd: null,
      fallbackPriorityGlobal: null,
      providerConfig: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isSystem: false,
      embeddingsUnsupported: false,
    });
    const executor = WorkflowNlpExecutionService.create({
      ids: new FixedWorkflowIdPort(),
      modelProviders: new TestModelProviderService({ openai: provider }),
      nlpRuntime: new TestWorkflowNlpRuntimePort(dispatchNlp),
      studioEvents: {
        enrich: async (event) => event.event,
        prepare: async (event) => event.event,
      },
    });

    await executor.execute({
      ...input,
      version: {
        ...input.version,
        dsl: {
          ...input.version.dsl,
          nodes: [
            {
              id: "signature",
              type: "signature",
              position: { x: 0, y: 0 },
              data: {
                llm: {
                  model: "openai/custom-model",
                  temperature: 0.4,
                  top_p: 0.8,
                },
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: {
                      model: "openai/custom-model",
                      temperature: 0.5,
                      top_p: 0.9,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const event = studioClientEventSchema.parse(dispatchNlp.mock.calls[0]?.[0]?.body);
    if (event.type !== "execute_flow") {
      throw new Error("Expected an execute_flow event.");
    }

    const signature = event.payload.workflow.nodes[0];
    const signatureData = z
      .looseObject({ llm: llmConfigSchema.optional() })
      .parse(signature?.data);
    const parameter = signature?.data.parameters?.[0];

    expect(signatureData.llm).toEqual({
      model: "openai/custom-model",
      temperature: 0.4,
    });
    expect(parameter?.value).toEqual({
      model: "openai/custom-model",
      temperature: 0.5,
    });
  });
});
