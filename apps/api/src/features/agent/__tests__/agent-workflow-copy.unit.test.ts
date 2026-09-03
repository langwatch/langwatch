import { describe, expect, it } from "vitest";
import {
  ApiAgentWorkflowCopyAdapter,
  type ApiAgentWorkflowCopier,
} from "../agent-workflow-copy.adapter";

/**
 * The agent half opens before the execution half, so the seam this adapter
 * occupies is a thunk. Both legs are driven here: the one where the Workflow
 * application resolved by the time a copy runs, and the one where it never did.
 */
describe("ApiAgentWorkflowCopyAdapter", () => {
  describe("given a process that composed a Workflow application", () => {
    it("copies the graph into the target project and answers with the new id", async () => {
      const calls: unknown[] = [];
      const workflows: ApiAgentWorkflowCopier = {
        copy: async (command) => {
          calls.push(command);
          return {
            workflow: { id: "workflow_copied" },
            version: {},
          } as unknown as Awaited<ReturnType<ApiAgentWorkflowCopier["copy"]>>;
        },
      };

      const adapter = ApiAgentWorkflowCopyAdapter.create({
        workflows: () => workflows,
        processName: "langwatch-api",
      });

      await expect(
        adapter.copy({
          workflowId: "workflow_source",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
          actorUserId: "user-1",
        }),
      ).resolves.toEqual({ workflowId: "workflow_copied" });

      expect(calls).toEqual([
        {
          sourceWorkflowId: "workflow_source",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
          copiedFromWorkflowId: "workflow_source",
          authorId: "user-1",
        },
      ]);
    });

    it("resolves the application at the copy, not at composition", async () => {
      let workflows: ApiAgentWorkflowCopier | undefined;
      const adapter = ApiAgentWorkflowCopyAdapter.create({
        workflows: () => workflows,
        processName: "langwatch-api",
      });

      workflows = {
        copy: async () =>
          ({ workflow: { id: "workflow_late" }, version: {} }) as unknown as Awaited<
            ReturnType<ApiAgentWorkflowCopier["copy"]>
          >,
      };

      await expect(
        adapter.copy({
          workflowId: "workflow_source",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
          actorUserId: "user-1",
        }),
      ).resolves.toEqual({ workflowId: "workflow_late" });
    });
  });

  describe("given a process that composed none", () => {
    it("refuses the copy and names the process, rather than writing a dangling agent", async () => {
      const adapter = ApiAgentWorkflowCopyAdapter.create({
        workflows: () => undefined,
        processName: "langwatch-api",
      });

      await expect(
        adapter.copy({
          workflowId: "workflow_source",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
          actorUserId: "user-1",
        }),
      ).rejects.toThrow(/langwatch-api composed no Workflow application/);
    });
  });
});
