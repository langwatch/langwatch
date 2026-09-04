/**
 * Finding H9 of the 2026-09-04 feature-surface security pass: `optimization.chat`
 * executes a published workflow — model spend, plus whatever the graph's code
 * and HTTP nodes do — so it declares the permission the public run endpoint
 * declares, not the permission to look at a workflow.
 *
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowApp } from "#app/workflow.app";
import {
  WorkflowOptimizationTrpcApi,
  type WorkflowOptimizationTrpcContext,
} from "../workflow-optimization.api";

/**
 * The host's real policy resolves the scope and refuses; this one records what
 * each procedure asked for, in declaration order, which is what is under test.
 */
function buildRouter() {
  const declared: AuthzPermission[] = [];
  const runPublishedWorkflow = vi.fn(async () => ({ status: "success", result: {} }));
  const trpc = initTRPC.context<WorkflowOptimizationTrpcContext>().create();

  const router = WorkflowOptimizationTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: (permission) => {
        declared.push(permission);
        return (procedure) => procedure;
      },
    },
    {
      runPublishedWorkflow,
      tryGetWorkflow: vi.fn(async () => null),
      tryGetWorkflowVersion: vi.fn(async () => null),
      listPublishedComponents: vi.fn(async () => []),
    },
  );

  const context: WorkflowOptimizationTrpcContext = { app: { workflows: {} as WorkflowApp } };

  return { caller: router.createCaller(context), declared, runPublishedWorkflow };
}

describe("optimization.chat", () => {
  /** @scenario Starting an optimization chat demands the permission to run a workflow */
  it("declares the run permission, the same one POST /api/workflows/:id/run declares", () => {
    const { declared } = buildRouter();

    // `chat` is the first procedure the router declares, so its permission is
    // the first the policy is handed.
    expect(declared[0]).toBe("workflows:manage");
  });

  it("runs the workflow the caller named, in the scope that was checked", async () => {
    const { caller, runPublishedWorkflow } = buildRouter();

    await caller.chat({
      projectId: "project_1",
      workflowId: "workflow_1",
      inputMessages: [{ input: "hello" }],
    });

    expect(runPublishedWorkflow).toHaveBeenCalledWith(expect.anything(), {
      workflowId: "workflow_1",
      projectId: "project_1",
      body: { input: "hello" },
    });
  });
});
