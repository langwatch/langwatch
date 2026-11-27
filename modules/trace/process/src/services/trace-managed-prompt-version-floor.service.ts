import { createLogger } from "@langwatch/observability";
import type { TraceManagedPromptVersionFloor } from "@langwatch/trace-contract";

import type { SpanAnalyticsFloorRepository } from "../repositories/span-analytics-floor.repository.ts";
import {
  MANAGED_PROMPT_VERSION_HISTORY_UNKNOWN,
  managedPromptVersionFloorOf,
} from "../rules/managed-prompt-version-floor.rules.ts";

const logger = createLogger("langwatch:trace:managed-prompt-version-floor");

/**
 * Where `LastUsedPromptVersionId` is known from, read through the ledger's read port alone, so it
 * cannot write the ledger. A read that fails answers `unknown`, never an error or the rows; with
 * no ledger composed yet it answers as a ledger with no row does.
 */
export class TraceManagedPromptVersionFloorService {
  static create({
    ledger,
  }: {
    ledger: SpanAnalyticsFloorRepository | null;
  }): TraceManagedPromptVersionFloorService {
    return new TraceManagedPromptVersionFloorService(ledger);
  }

  private constructor(private readonly ledger: SpanAnalyticsFloorRepository | null) {}

  async getFloor(): Promise<TraceManagedPromptVersionFloor> {
    try {
      const records = this.ledger ? await this.ledger.findReplayStep() : [];
      return managedPromptVersionFloorOf(records);
    } catch (error) {
      logger.warn({ error }, "managed prompt version ledger read failed; answering unknown");
      return { ...MANAGED_PROMPT_VERSION_HISTORY_UNKNOWN };
    }
  }
}
