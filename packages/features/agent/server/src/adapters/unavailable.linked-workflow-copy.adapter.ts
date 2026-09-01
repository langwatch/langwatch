import { LinkedWorkflowCopyPort } from "../ports/linked-workflow-copy.port";

/**
 * The linked-workflow copy of a process that composes no Workflow application.
 *
 * It refuses, loudly and by name, and that is the point. The two alternatives
 * are both worse:
 *
 *  - copying the agent row and leaving `workflowId` pointing at the SOURCE
 *    project's graph writes a cross-project reference that every caller reads
 *    as a successful copy, and
 *  - copying the agent row with no workflow at all turns a workflow agent into
 *    an agent whose graph does not exist.
 *
 * Refusing keeps the property structural rather than something a composition
 * root has to remember: a process that later composes a Workflow application
 * supplies the real port and the operation starts working, and a process that
 * never does fails the one operation it cannot perform instead of the twelve
 * it can.
 *
 * The refusal is a plain `Error` on purpose. Nothing the caller sends causes
 * it and nothing the caller can send avoids it — it is a fact about which
 * tier is serving them — so it degrades to a generic failure carrying the
 * trace id rather than dressing a deployment shape up as a customer's mistake.
 */
export class UnavailableLinkedWorkflowCopyAdapter extends LinkedWorkflowCopyPort {
  static create(options: {
    /** Names the process in the refusal, so a stack trace says whose gap this is. */
    processName: string;
  }): UnavailableLinkedWorkflowCopyAdapter {
    return new UnavailableLinkedWorkflowCopyAdapter(options.processName);
  }

  private constructor(private readonly processName: string) {
    super();
  }

  copy(input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actorUserId: string;
  }): Promise<{ workflowId: string }> {
    return Promise.reject(this.refuse(input.workflowId));
  }

  private refuse(workflowId: string): Error {
    return new Error(
      `${this.processName} composes no Workflow application, so it cannot copy the Studio graph "${workflowId}" that this workflow agent points at. Copying a workflow agent has to copy its graph; copy it from a process that composes the Workflow application.`,
    );
  }
}
