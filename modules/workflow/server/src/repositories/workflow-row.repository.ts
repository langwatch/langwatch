/**
 * The bare workflow row a Studio copy lands in, before its first version
 * exists.
 *
 * A copy is two writes with the caller's own graph rewrite between them, and
 * this is the first of them. The lifecycle's own `copy` writes both at once,
 * so this seam keeps the two-step available without duplicating the version
 * rules.
 */

/** The stored workflow a copy lands in, before its first version exists. */
export type WorkflowRowDraft = {
  id: string;
  projectId: string;
  name: string;
  icon: string;
  description: string;
  isEvaluator: boolean;
  isComponent: boolean;
  copiedFromWorkflowId: string;
};

export abstract class WorkflowRowRepository {
  abstract create(input: WorkflowRowDraft): Promise<void>;
}
