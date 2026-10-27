/**
 * Writes the bare workflow row a Studio copy lands in. Moved unchanged from
 * the platform app's `runtime/app/features/workflow.ts`: one create against
 * the workflow table, with the draft as the row.
 */
import type { WorkflowUsageCount } from "@langwatch/workflow-contract";

import { WorkflowRowRepository, type WorkflowRowDraft } from "../workflow-row.repository.ts";

/** The one table this repository writes, named structurally. */
export type WorkflowRowDatabase = {
  workflow: {
    create(input: { data: WorkflowRowDraft }): Promise<unknown>;
    count(input: {
      where: { projectId: { in: string[] }; createdAt?: { gte: Date } };
    }): Promise<number>;
    findFirst(input: {
      where: { projectId: { in: string[] } };
      orderBy: { createdAt: "asc" };
      select: { createdAt: true };
    }): Promise<{ createdAt: Date } | null>;
  };
};

export class WorkflowRowPrismaRepository extends WorkflowRowRepository {
  static create(options: { database: WorkflowRowDatabase }): WorkflowRowPrismaRepository {
    return new WorkflowRowPrismaRepository(options.database);
  }

  private constructor(private readonly database: WorkflowRowDatabase) {
    super();
  }

  async create(input: WorkflowRowDraft): Promise<void> {
    await this.database.workflow.create({ data: input });
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<WorkflowUsageCount> {
    const scope = { projectId: { in: [...projectIds] } };
    const [workflows, first] = await Promise.all([
      this.database.workflow.count({
        where: since === undefined ? scope : { ...scope, createdAt: { gte: new Date(since) } },
      }),
      this.database.workflow.findFirst({
        where: scope,
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    return { workflows, ...(first ? { firstWorkflowAt: first.createdAt.getTime() } : {}) };
  }
}
