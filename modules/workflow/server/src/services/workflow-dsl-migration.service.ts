/**
 * Upgrading a persisted graph to the current spec version before it becomes
 * the workflow's current version.
 *
 * Moved from the platform app's `runtime/app/features/workflow.ts`. The
 * migration itself has always been the contract's; the seam existed only so
 * the process could decide whether to run it, and every process runs it.
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
