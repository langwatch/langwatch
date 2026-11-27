import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { DataRetentionModule } from "../app/data-retention.app.ts";

const logger = createLogger("langwatch:data-retention:retention-drift");

type Requester = Pick<DataRetentionModule, "requestRetentionDriftCheck">;

/**
 * Sends the drift check now, for one organization or for all: the operator's way to look for
 * stored rows on an old period without waiting for the daily wake.
 */
export class RetentionDriftCheckTask extends Task {
  readonly name = "retention-drift-check";
  readonly description =
    "Flags projects whose stored rows carry a retention other than their current setting.";

  private constructor(private readonly requests: Requester) {
    super();
  }

  static create({ requests }: { requests: Requester }): RetentionDriftCheckTask {
    return new RetentionDriftCheckTask(requests);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const [organizationId] = args;
    const outcome = await this.requests.requestRetentionDriftCheck(
      organizationId ? { organizationId } : {},
    );
    logger.info({ organizationId, outcome }, "Retention drift check requested");
  }
}
