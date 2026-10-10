import type { WorkflowReference } from "@langwatch/workflow-contract";

import type { WorkflowRepository } from "../repositories/workflow.repository.ts";

/** What one pass did across the live workflows; the ledger keeps it. */
type WorkflowCurrentVersionBackfillReport = {
  tenants: number;
  liveWorkflows: number;
  versionsRecorded: number;
};

/**
 * Records each live workflow's current version with its fields, so agent learns the fields of
 * graphs saved before version_saved carried them (modules/workflow/specs/workflow-service.feature).
 * Level-triggered: a second pass records the same fields again, which agent folds to no change.
 */
export class WorkflowCurrentVersionBackfillService {
  static create(deps: {
    workflows: Pick<WorkflowRepository, "findProjectIds" | "findAll">;
    versions: { recordCurrentVersionFields(input: WorkflowReference): Promise<boolean> };
  }): WorkflowCurrentVersionBackfillService {
    return new WorkflowCurrentVersionBackfillService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof WorkflowCurrentVersionBackfillService.create>[0],
  ) {}

  async recordLiveWorkflows({
    dryRun,
    signal,
    afterTenantId,
    onTenantDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    afterTenantId: string | null;
    onTenantDone: (input: {
      tenantId: string;
      report: WorkflowCurrentVersionBackfillReport;
    }) => Promise<void>;
  }): Promise<WorkflowCurrentVersionBackfillReport> {
    const report: WorkflowCurrentVersionBackfillReport = {
      tenants: 0,
      liveWorkflows: 0,
      versionsRecorded: 0,
    };
    const tenantIds = (await this.deps.workflows.findProjectIds()).toSorted();
    for (const tenantId of tenantIds) {
      if (signal.aborted) break;
      if (afterTenantId !== null && tenantId <= afterTenantId) continue;
      report.tenants += 1;
      await this.recordTenant({ tenantId, dryRun, report });
      if (!dryRun) await onTenantDone({ tenantId, report });
    }
    return report;
  }

  private async recordTenant({
    tenantId,
    dryRun,
    report,
  }: {
    tenantId: string;
    dryRun: boolean;
    report: WorkflowCurrentVersionBackfillReport;
  }): Promise<void> {
    for (const workflow of await this.deps.workflows.findAll({ projectId: tenantId })) {
      report.liveWorkflows += 1;
      if (dryRun) continue;
      const recorded = await this.deps.versions.recordCurrentVersionFields({
        workflowId: workflow.id,
        projectId: tenantId,
      });
      if (recorded) report.versionsRecorded += 1;
    }
  }
}
