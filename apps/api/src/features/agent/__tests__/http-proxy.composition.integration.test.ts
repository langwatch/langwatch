import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { studioWorkflowSchema, type ExecuteWorkflowComponentInput, type WorkflowApi } from "@langwatch/workflow-contract";
import {
  HttpWorkflowStudioStreamAdapter,
  WorkflowApp,
  WorkflowStudioDispatchService,
  type WorkflowAgentMappingPort,
  type WorkflowRowPort,
  type WorkflowStudioDslPort, type WorkflowService,} from "@langwatch/workflow-server";
import { describe, expect, it, vi } from "vitest";

const input: ExecuteWorkflowComponentInput = {
  projectId: "project-1",
  nodeId: "node-1",
  traceId: "trace-1",
  inputs: { question: "hello" },
  origin: "agent_test",
  workflow: studioWorkflowSchema.parse({
    name: "Agent test",
    description: "An HTTP agent request",
    version: "1",
    spec_version: "1.4",
    icon: "test",
    workflow_id: "workflow-1",
    nodes: [],
    edges: [],
    state: {},
    default_llm: { model: "openai/gpt-4o" },
  }),
};

function workflowApp(studioDispatch?: WorkflowStudioDispatchService): WorkflowApi {
  return WorkflowApp.create({
    infrastructure: {
      studioDispatch,
      workflows: createApiFixture<WorkflowService>(),
      datasets: createApiFixture<DatasetService>(),
      evaluators: createApiFixture<EvaluatorApi>(),
      studioDsl: createApiFixture<WorkflowStudioDslPort>(),
      agentMappings: createApiFixture<WorkflowAgentMappingPort>(),
      workflowRows: createApiFixture<WorkflowRowPort>(),
    },
    dependencies: {},
    config: void 0,
    resources: new ResourceScope(),
  });
}

function dispatching(events: object[]) {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const engine = vi.fn<typeof fetch>().mockImplementation(async () => new Response(payload));
  const dispatch = WorkflowStudioDispatchService.create({
    stream: HttpWorkflowStudioStreamAdapter.create({
      serviceUrl: "http://127.0.0.1:5561",
      fetch: engine,
    }),
    modelProviders: createApiFixture<ModelProviderApi>({ getForProject: async () => ({}) }),
  });
  return { app: workflowApp(dispatch), engine };
}

describe("Workflow component execution behind the Agent HTTP test", () => {
  /** @scenario "HTTP agent execution reaches the composed Workflow API" */
  it("returns the requested component's final state from the real engine stream", async () => {
    const state = {
      status: "success",
      outputs: { answer: "hello" },
      http: { status_code: 201 },
      timestamps: { started_at: 1000, finished_at: 1250 },
    };
    const { app, engine } = dispatching([
      {
        type: "component_state_change",
        payload: { component_id: "other", execution_state: { status: "error" } },
      },
      {
        type: "component_state_change",
        payload: { component_id: "node-1", execution_state: state },
      },
      { type: "done", payload: {} },
    ]);
    await expect(app.executeComponent(input)).resolves.toEqual(state);
    expect(engine).toHaveBeenCalledOnce();
    const body = JSON.parse(String(engine.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      type: "execute_component",
      payload: {
        trace_id: "trace-1",
        node_id: "node-1",
        inputs: input.inputs,
        origin: "agent_test",
      },
    });
  });

  it("refuses missing component results instead of manufacturing success", async () => {
    const { app } = dispatching([{ type: "done", payload: {} }]);
    await expect(app.executeComponent(input)).rejects.toMatchObject({
      code: "workflow_execution_failed",
    });
  });

  it("refuses execution when no studio dispatcher was composed", async () => {
    await expect(workflowApp().executeComponent(input)).rejects.toMatchObject({
      code: "workflow_execution_failed",
    });
  });
});
