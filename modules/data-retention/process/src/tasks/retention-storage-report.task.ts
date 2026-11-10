import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { DataRetentionModule } from "../app/data-retention.app.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

type Requester = Pick<DataRetentionModule, "requestRetentionStorageReport">;

/**
 * Sends today's measure command now, for one organization or for all: the operator's way to
 * report a day the schedule missed. The worker measures and bills behind the command, and the
 * day's meter identifier keeps a rerun harmless.
 */
export class RetentionStorageReportTask extends Task {
  readonly name = "retention-storage-report";
  readonly description =
    "Reports storage kept past the included 90 days to billing, for one organization or all.";

  private constructor(private readonly requests: Requester) {
    super();
  }

  static create({ requests }: { requests: Requester }): RetentionStorageReportTask {
    return new RetentionStorageReportTask(requests);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const [organizationId] = args;
    const outcome = await this.requests.requestRetentionStorageReport(
      organizationId ? { organizationId } : {},
    );
    logger.info({ organizationId, outcome }, "Retention storage report requested");
  }
}
