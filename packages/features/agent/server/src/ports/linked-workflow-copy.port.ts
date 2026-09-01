/**
 * Copying the Studio graph a workflow agent points at.
 *
 * The other four operations an agent needs from its linked workflow — the
 * fields it declares, its name, archiving it, deleting it — are reads and
 * writes over the workflow row and its versions. This one is not. A copied
 * graph is a new workflow AND a new version written under the Workflow
 * lifecycle's own rules: its dataset copier, its DSL rewrite, its version
 * parentage. A process that composes no Workflow application cannot do it.
 *
 * So it is a port of its own, and the gap is a MISSING PORT rather than a
 * method that quietly does less. An agent copied without its graph is an agent
 * in one project pointing at another project's workflow, which reads to every
 * caller as a copy that succeeded.
 */
export abstract class LinkedWorkflowCopyPort {
  abstract copy(input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actorUserId: string;
  }): Promise<{ workflowId: string }>;
}
