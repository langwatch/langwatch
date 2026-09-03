/**
 * Copying a WORKFLOW agent, over the Workflow application this process
 * already composes.
 *
 * A bridge in the PROCESS rather than in either package: `agent` and
 * `workflow` are both core features and neither may reach the other, so the
 * seam is the composition root's. It is the same shape
 * `ApiUserAvatarStorageAdapter` occupies for the avatar write.
 *
 * The service arrives as a THUNK because of composition order, not taste.
 * `resolveAgents` runs before `composeExecution`, and the Workflow service is
 * built by the latter, so a service read at composition time would always be
 * absent. It is read at the copy instead, which is the only moment it is
 * needed — the same reason the avatar write takes its store as a thunk.
 *
 * `copiedFromWorkflowId` is stamped with the SOURCE workflow, so a copied
 * agent's graph carries its parentage. Omitting it would make the copy read as
 * an original, which is the one thing the linked-workflow read exists to tell
 * apart.
 */
import { LinkedWorkflowCopyPort } from "@langwatch/agent-server";
import type { WorkflowService } from "@langwatch/workflow-contract";

/**
 * The one operation an agent copy performs on the Workflow application.
 *
 * Narrowed rather than taking the whole service because that is honestly all
 * this adapter reaches for, and because a narrowed seam is one a test can put
 * a real double in front of instead of casting a half-built service into place.
 */
export type ApiAgentWorkflowCopier = Pick<WorkflowService, "copy">;

/** Copies the Studio graph a linked agent points at, into the target project. */
export class ApiAgentWorkflowCopyAdapter extends LinkedWorkflowCopyPort {
  static create(options: {
    /** The Workflow application, resolved at the copy rather than at composition. */
    workflows: () => ApiAgentWorkflowCopier | undefined;
    /** Names the process in the refusal, so a stack trace says whose gap this is. */
    processName: string;
  }): ApiAgentWorkflowCopyAdapter {
    return new ApiAgentWorkflowCopyAdapter(options.workflows, options.processName);
  }

  private constructor(
    private readonly workflows: () => ApiAgentWorkflowCopier | undefined,
    private readonly processName: string,
  ) {
    super();
  }

  async copy(input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actorUserId: string;
  }): Promise<{ workflowId: string }> {
    const workflows = this.workflows();
    if (!workflows) {
      // A plain `Error` on purpose. Nothing the caller sends causes it and
      // nothing they can send avoids it — it is a fact about which tier is
      // serving them — so it degrades to a generic failure carrying the trace
      // id rather than dressing a deployment shape up as a customer's mistake.
      throw new Error(
        `${this.processName} composed no Workflow application, so it cannot copy the graph workflow "${input.workflowId}" points at.`,
      );
    }

    const copied = await workflows.copy({
      sourceWorkflowId: input.workflowId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
      copiedFromWorkflowId: input.workflowId,
      authorId: input.actorUserId,
    });
    return { workflowId: copied.workflow.id };
  }
}
