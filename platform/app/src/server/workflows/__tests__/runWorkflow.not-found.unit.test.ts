import { describe, expect, it, vi } from "vitest";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import {
  WorkflowNlpExecutor,
  type WorkflowExecutionRuntime,
} from "../runWorkflow";

const workflow: StudioWorkflow = {
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
};

const input = {
  projectId: "project_1",
  workflowId: "workflow_1",
  inputs: { ticket: "42" },
  version: {
    id: "version_1",
    workflowId: "workflow_1",
    projectId: "project_1",
    version: "1",
    autoSaved: false,
    commitMessage: "first",
    authorId: null,
    parentId: null,
    dsl: { name: "Triage", version: "1", nodes: [], edges: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe("WorkflowNlpExecutor", () => {
  it("dispatches the already-resolved version without a persistence dependency", async () => {
    const dispatchNlp = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ result: {}, status: "success" }),
    });
    const runtime: WorkflowExecutionRuntime = {
      migrateDsl: vi.fn().mockReturnValue(workflow),
      getProjectModelProviders: vi.fn().mockResolvedValue({}),
      stripUnsupportedParams: vi.fn().mockResolvedValue(undefined),
      addEnvs: async (event) => event,
      dispatchNlp,
      createTraceId: () => "trace_generated",
    };

    const result = await WorkflowNlpExecutor.create(runtime).execute(input);

    expect(result).toEqual({ result: {}, status: "success" });
    expect(runtime.migrateDsl).toHaveBeenCalledWith(input.version.dsl);
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
});
