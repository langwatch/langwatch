/**
 * The bare workflow row a Studio copy lands in, in memory. Writes into the
 * same store the lifecycle repository reads, so a copy row here is a
 * workflow the lifecycle can commit a version against, like the Prisma pair.
 */
import { nowInstant, toDate } from "@langwatch/time";
import type { Workflow, WorkflowUsageCount } from "@langwatch/workflow-contract";

import { WorkflowRowRepository, type WorkflowRowDraft } from "../workflow-row.repository.ts";
import type { WorkflowMemoryStore } from "./workflow-memory.store.ts";

export class WorkflowRowMemoryRepository extends WorkflowRowRepository {
  static create(store: WorkflowMemoryStore): WorkflowRowMemoryRepository {
    return new WorkflowRowMemoryRepository(store);
  }

  private constructor(private readonly store: WorkflowMemoryStore) {
    super();
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<WorkflowUsageCount> {
    const made = [...this.store.workflows.values()]
      .filter((workflow) => projectIds.includes(workflow.projectId))
      .map((workflow) => workflow.createdAt.getTime());
    return {
      workflows: made.filter((at) => since === undefined || at >= since).length,
      ...(made.length === 0 ? {} : { firstWorkflowAt: Math.min(...made) }),
    };
  }

  create(input: WorkflowRowDraft): Promise<void> {
    const now = toDate(nowInstant());
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
