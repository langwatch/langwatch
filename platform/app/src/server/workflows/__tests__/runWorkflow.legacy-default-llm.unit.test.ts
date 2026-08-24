import { describe, expect, it, vi } from "vitest";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import {
  WorkflowNlpExecutor,
  migrateWorkflowDslForExecution,
  type WorkflowExecutionRuntime,
} from "../runWorkflow";

const migratedLegacyWorkflow: Workflow = {
  spec_version: "1.5",
  workflow_id: "workflow_1",
  name: "Legacy published workflow",
  icon: "🧩",
  description: "",
  version: "1",
  template_adapter: "default",
  enable_tracing: true,
  state: {},
  nodes: [
    {
      id: "llm_call",
      type: "signature",
      position: { x: 0, y: 0 },
      data: {
        name: "LLM Call",
        parameters: [
          {
            identifier: "llm",
            type: "llm",
            value: { model: "openai/gpt-5-mini", max_tokens: 256 },
          },
        ],
        inputs: [],
        outputs: [],
      },
    },
  ],
  edges: [],
};

describe("WorkflowNlpExecutor with a migrated legacy version", () => {
  it("upgrades a pre-1.5 version before execution", () => {
    const migrated = migrateWorkflowDslForExecution({
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
    const runtime: WorkflowExecutionRuntime = {
      migrateDsl: vi.fn().mockReturnValue(migratedLegacyWorkflow),
      getProjectModelProviders: vi.fn().mockResolvedValue({}),
      stripUnsupportedParams: vi.fn().mockResolvedValue(undefined),
      addEnvs: async (event) => event,
      dispatchNlp,
      createTraceId: () => "trace_1",
    };
    const executor = WorkflowNlpExecutor.create(runtime);

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
          name: "Legacy published workflow",
          version: "1",
          nodes: [],
          edges: [],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const event = dispatchNlp.mock.calls[0]?.[0]?.body;
    const signature = event?.payload.workflow.nodes.find(
      (node: { type: string }) => node.type === "signature",
    );
    const llm = signature?.data.parameters?.find(
      (parameter: { type: string }) => parameter.type === "llm",
    )?.value;
    expect(llm).toEqual({ model: "openai/gpt-5-mini", max_tokens: 256 });
  });
});
