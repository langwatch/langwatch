/**
 * Upgrading a persisted graph to the current spec version before it becomes
 * the workflow's current version. Moved unchanged from the platform app's
 * `runtime/app/features/workflow.ts` — every process now runs it.
 */
import { migrateDSLVersion, type WorkflowDsl } from "@langwatch/workflow-contract";
import { type WorkflowDslMigration } from "../app/workflow.app.ts";

export class ContractWorkflowDslMigrationAdapter implements WorkflowDslMigration {
  static create(): ContractWorkflowDslMigrationAdapter {
    return new ContractWorkflowDslMigrationAdapter();
  }

  private constructor() {}

  migrate(dsl: WorkflowDsl): WorkflowDsl {
    return migrateDSLVersion(dsl);
  }
}
