import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { DataRetentionModule } from "../app/data-retention.app.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

type Reporter = Pick<
  DataRetentionModule,
  "reportRetentionStorage" | "reportOrganizationRetentionStorage"
>;

/**
 * Runs the daily retention storage report now, for one organization or for all: the operator's
 * way to report a day the schedule missed. The per-day meter identifier keeps a rerun harmless.
 */
export class RetentionStorageReportTask extends Task {
  readonly name = "retention-storage-report";
  readonly description =
    "Reports storage kept past the included 90 days to billing, for one organization or all.";

  private constructor(private readonly reporter: Reporter) {
    super();
  }

  static create({ reporter }: { reporter: Reporter }): RetentionStorageReportTask {
    return new RetentionStorageReportTask(reporter);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const [organizationId] = args;
    const outcome = organizationId
      ? await this.reporter.reportOrganizationRetentionStorage({ organizationId })
      : await this.reporter.reportRetentionStorage();
    logger.info({ organizationId, outcome }, "Retention storage report ran");
  }
}
