/**
 * The bare workflow row a Studio copy lands in, before its first version
 * exists.
 *
 * Moved from the platform app's `runtime/app/features/workflow.ts` unchanged.
 * A copy is two writes with the caller's own graph rewrite between them, and
 * this is the first of them.
 */
import { WorkflowRowPort, type WorkflowRowDraft } from "../ports/workflow.port";

/** The one table this adapter writes, named structurally. */
export type WorkflowRowDatabase = {
  workflow: { create(input: { data: WorkflowRowDraft }): Promise<unknown> };
};

export class PrismaWorkflowRowAdapter extends WorkflowRowPort {
  static create(options: { database: WorkflowRowDatabase }): PrismaWorkflowRowAdapter {
    return new PrismaWorkflowRowAdapter(options);
  }

  private constructor(private readonly options: { database: WorkflowRowDatabase }) {
    super();
  }

  async create(input: WorkflowRowDraft): Promise<void> {
    await this.options.database.workflow.create({ data: input });
  }
}
