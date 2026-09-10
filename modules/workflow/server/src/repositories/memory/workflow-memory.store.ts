/**
 * The one in-memory store every memory-tier workflow repository writes into.
 *
 * One store behind every row, the way one Prisma client serves them: a
 * workflow written through the lifecycle is the workflow a copy row reads
 * back, and a secret written for a project is the secret an environment read
 * answers with.
 */
import type { Workflow, WorkflowVersion } from "@langwatch/workflow-contract";

/** A project's stored run environment, as the memory tier holds it. */
export type StoredEnvironmentRow = {
  apiKey: string;
  secrets: Array<{ name: string; encryptedValue: string }>;
};

export class WorkflowMemoryStore {
  static create(): WorkflowMemoryStore {
    return new WorkflowMemoryStore();
  }

  readonly workflows = new Map<string, Workflow>();
  readonly versions = new Map<string, WorkflowVersion>();
  readonly environments = new Map<string, StoredEnvironmentRow>();
  /** Author display rows a version history joins, keyed by author id. */
  readonly authors = new Map<string, { name: string | null; image: string | null }>();

  private constructor() {}

  /** Every workflow of one project, newest update first. */
  workflowsOf(projectId: string): Workflow[] {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.projectId === projectId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  /** Every version of one workflow, newest first, the way Prisma orders them. */
  versionsOf(input: { workflowId: string; projectId: string }): WorkflowVersion[] {
    return [...this.versions.values()]
      .filter(
        (version) =>
          version.workflowId === input.workflowId && version.projectId === input.projectId,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }
}
