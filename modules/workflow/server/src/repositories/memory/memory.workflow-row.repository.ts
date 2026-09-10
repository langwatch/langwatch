/**
 * The bare workflow row a Studio copy lands in, in memory.
 *
 * It writes into the same store the memory lifecycle repository reads, so a
 * copy row created here is a workflow the lifecycle then commits a version
 * against, exactly as the two Prisma writes behave.
 */
import type { Workflow } from "@langwatch/workflow-contract";
import {
  WorkflowRowRepository,
  type WorkflowRowDraft,
} from "../workflow-row.repository.ts";
import type { WorkflowMemoryStore } from "./workflow-memory.store.ts";

export class WorkflowRowMemoryRepository extends WorkflowRowRepository {
  static create(store: WorkflowMemoryStore): WorkflowRowMemoryRepository {
    return new WorkflowRowMemoryRepository(store);
  }

  private constructor(private readonly store: WorkflowMemoryStore) {
    super();
  }

  create(input: WorkflowRowDraft): Promise<void> {
    const now = new Date();
    const workflow: Workflow = {
      ...input,
      latestVersionId: null,
      currentVersionId: null,
      publishedId: null,
      publishedById: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.workflows.set(workflow.id, workflow);

    return Promise.resolve();
  }
}
