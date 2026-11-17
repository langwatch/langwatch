import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { DatasetStorageAuditService } from "../services/dataset-storage-audit.service.ts";

/** Where the report goes: the task's own logger unless a caller hands one. */
type AuditLog = { info(fields: object, message: string): void };

/**
 * `pnpm task dataset-storage-audit`: logs, per organization, the datasets and rows still to move
 * to object storage and the records-table rows left for the cleanup. Reads only.
 */
export class DatasetStorageAuditTask extends Task {
  readonly name = "dataset-storage-audit";
  readonly description =
    "Lists, per organization, the dataset content still outside object storage, changing nothing.";

  private constructor(
    private readonly service: DatasetStorageAuditService,
    private readonly log: AuditLog,
  ) {
    super();
  }

  static create({
    audit,
    logger = createLogger("langwatch:task:dataset-storage-audit"),
  }: {
    audit: DatasetStorageAuditService;
    logger?: AuditLog;
  }): DatasetStorageAuditTask {
    return new DatasetStorageAuditTask(audit, logger);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const report = await this.service.audit({ signal });
    for (const organization of report.organizations) {
      this.log.info(organization, "Dataset storage left for one organization");
    }
    this.log.info(
      { organizations: report.organizations.length, ...report.totals },
      "Dataset storage left in total",
    );
  }
}
