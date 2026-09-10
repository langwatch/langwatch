/**
 * Writes the bare workflow row a Studio copy lands in.
 *
 * Moved from the platform app's `runtime/app/features/workflow.ts` unchanged:
 * one create against the workflow table, with the draft as the row.
 */
import {
  WorkflowRowRepository,
  type WorkflowRowDraft,
} from "../workflow-row.repository.ts";

/** The one table this repository writes, named structurally. */
export type WorkflowRowDatabase = {
  workflow: { create(input: { data: WorkflowRowDraft }): Promise<unknown> };
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
}
