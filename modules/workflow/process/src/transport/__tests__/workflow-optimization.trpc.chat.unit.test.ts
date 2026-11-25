/**
 * `optimization.chat` runs the workflow the caller named, in the scope that was
 * checked - on the same application operation the public run endpoint reaches.
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { workflowOptimizationTrpcTransport } from "../workflow-optimization.trpc.ts";

type Invoke = (args: {
  app: WorkflowApi;
  input: unknown;
  actor: { id: string };
  scope: { tier: "project"; id: string };
  signal: undefined;
}) => unknown;

/** The declaration mounted on a runtime that keeps each handler callable. */
function callersFor(app: WorkflowApi): ReadonlyMap<string, (input: unknown) => unknown> {
  const callers = new Map<string, (input: unknown) => unknown>();

  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      const invoke: Invoke = (args) => Reflect.apply(request.handle, undefined, [args]);
      const name = request.procedure.split(".")[1] ?? request.procedure;

      callers.set(name, (input) =>
        invoke({
          app,
          input,
          actor: { id: "user_1" },
          scope: { tier: "project", id: "project_1" },
          signal: undefined,
        }),
      );

      return {};
    },
    router: (record) => record,
  };

  workflowOptimizationTrpcTransport.router(runtime, () => app);

  return callers;
}

describe("optimization.chat", () => {
  describe("given a published workflow the caller may run", () => {
    it("runs the workflow the caller named, in the scope that was checked", async () => {
      const runPublished = vi.fn<WorkflowApi["runPublished"]>(async () => ({
        status: "success",
        result: {},
      }));
      const callers = callersFor(createApiFixture<WorkflowApi>({ runPublished }, "WorkflowApi"));

      await callers.get("chat")?.({
        projectId: "project_1",
        workflowId: "workflow_1",
        inputMessages: [{ input: "hello" }],
      });

      expect(runPublished).toHaveBeenCalledWith({
        workflowId: "workflow_1",
        projectId: "project_1",
        body: { input: "hello" },
        principal: { userId: "user_1" },
      });
    });

    it("sends an empty body when the chat carried no message", async () => {
      const runPublished = vi.fn<WorkflowApi["runPublished"]>(async () => ({
        status: "success",
        result: {},
      }));
      const callers = callersFor(createApiFixture<WorkflowApi>({ runPublished }, "WorkflowApi"));

      await callers.get("chat")?.({
        projectId: "project_1",
        workflowId: "workflow_1",
        inputMessages: [],
      });

      expect(runPublished).toHaveBeenCalledWith(expect.objectContaining({ body: {} }));
    });
  });
});

describe("optimization.getPublishedWorkflow", () => {
  /** @scenario "A published workflow read never carries a saved HTTP agent's credentials" */
  it("answers a published graph with a saved HTTP agent's credentials blank", async () => {
    const getPublishedWorkflow = vi.fn<WorkflowApi["getPublishedWorkflow"]>(async () => ({
      published: true,
      workflow: {
        version: "1",
        isComponent: false,
        isEvaluator: false,
        dsl: {
          nodes: [
            {
              id: "http_agent",
              data: {
                agent: "agents/agent_1",
                parameters: [
                  { identifier: "agent_type", type: "str", value: "http" },
                  { identifier: "auth_token", type: "str", value: "token-secret" },
                  {
                    identifier: "headers",
                    type: "dict",
                    value: { "x-api-key": "key-secret", "x-tenant": "acme" },
                  },
                ],
              },
            },
          ],
        },
      },
    }));
    const callers = callersFor(
      createApiFixture<WorkflowApi>({ getPublishedWorkflow }, "WorkflowApi"),
    );

    const answered = await callers.get("getPublishedWorkflow")?.({
      projectId: "project_1",
      workflowId: "workflow_1",
    });

    expect(JSON.stringify(answered)).not.toContain("token-secret");
    expect(JSON.stringify(answered)).not.toContain("key-secret");
    // Only credential-named headers are blanked; any other header is answered as typed.
    expect(JSON.stringify(answered)).toContain('"x-tenant":"acme"');
    expect(answered).toMatchObject({ version: "1" });
  });

  it("answers null when nothing is published", async () => {
    const callers = callersFor(
      createApiFixture<WorkflowApi>(
        { getPublishedWorkflow: async () => ({ published: false }) },
        "WorkflowApi",
      ),
    );

    expect(
      await callers.get("getPublishedWorkflow")?.({ projectId: "project_1", workflowId: "w" }),
    ).toBeNull();
  });
});
