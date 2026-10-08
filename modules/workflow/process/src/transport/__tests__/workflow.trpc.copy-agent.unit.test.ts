/**
 * @vitest-environment node
 * `workflow.copyAgent` over the real runtime, with the workflow application faked.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import type { AgentApiCopyRequest } from "@langwatch/agent-contract";
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { WorkflowApi, WorkflowCaller } from "@langwatch/workflow-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { workflowTrpcTransport, type WorkflowBrowserApi } from "../workflow.trpc.ts";

type TestContext = { actor: { id: string } };

function mount({ permits = true }: { permits?: boolean } = {}) {
  const calls: { input: AgentApiCopyRequest; by: WorkflowCaller }[] = [];
  const asked: unknown[] = [];
  const browser: WorkflowBrowserApi = {
    workflows: () => createApiFixture<WorkflowApi>({}, "WorkflowApi"),
    copyAgent: async (input, by) => {
      calls.push({ input, by });
      return {
        id: input.newAgentId ?? "agent_new",
        projectId: input.projectId,
        name: "Studio agent",
        copiedFromAgentId: input.agentId,
      };
    },
  };
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => {
        asked.push(permission);
        return permits;
      },
    }),
  }).mount(workflowTrpcTransport, () => browser);

  return { calls, asked, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

const input = {
  agentId: "agent_source",
  projectId: "project_target",
  sourceProjectId: "project_source",
  newAgentId: "agent_copy",
};

describe("workflow.copyAgent", () => {
  describe("when the caller may manage evaluations in the target project", () => {
    /** @scenario "The agent copy door keeps the agents.copy input, output and permission" */
    it("hands agents.copy's input and the caller to the copy, answering agents.copy's output", async () => {
      const { caller, calls, asked } = mount();

      await expect(caller.copyAgent(input)).resolves.toEqual({
        id: "agent_copy",
        projectId: "project_target",
        name: "Studio agent",
        copiedFromAgentId: "agent_source",
      });
      expect(asked).toEqual(["evaluations:manage"]);
      expect(calls).toMatchObject([{ input, by: { id: "user_1" } }]);
    });
  });

  describe("when the caller may not manage evaluations in the target project", () => {
    /** @scenario "The agent copy door keeps the agents.copy input, output and permission" */
    it("is refused at the door before the copy runs", async () => {
      const { caller, calls } = mount({ permits: false });

      await expect(caller.copyAgent(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(calls).toEqual([]);
    });
  });
});
