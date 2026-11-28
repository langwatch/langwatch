/**
 * Sends a scoped LangWatchQL read to the floored twins its lower bounds allow, and as written
 * while a twin is not readable yet (analytics ADR-005, ADR-006).
 * @see specs/lwql/dedup-floor.feature
 */
import {
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";

import type {
  LangWatchQLExecutionRequest,
  LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../repositories/langwatch-ql-executor.repository.ts";
import { floorLangWatchQLDedup } from "../rules/lwql-dedup-floor.rules.ts";
import type { LangWatchQLViewDefinition } from "./langwatch-ql-catalog-shapes.service.ts";

const logger = createLogger("langwatch:analytics:lwql");

/** One floored read, and its fallback, for every LangWatchQL statement the app sends. */
export class LangWatchQLFlooredReadService {
  static create(): LangWatchQLFlooredReadService {
    return new LangWatchQLFlooredReadService();
  }

  private constructor() {}

  /**
   * Runs `request` with each bounded read of a floorable view sent to its floored twin. Its SQL
   * must already be scoped: the scope reads the views by name, and the floor reads its bound.
   */
  async execute({
    executor,
    request,
    database,
    views,
  }: {
    executor: LangWatchQLExecutorRepository;
    request: LangWatchQLExecutionRequest;
    /** Where unqualified view names resolve. */
    database: string;
    views: readonly LangWatchQLViewDefinition[];
  }): Promise<LangWatchQLExecutionResult> {
    const floored = floorLangWatchQLDedup({ sql: request.sql, database, views });
    if (floored === request.sql) return executor.execute(request);
    return executor.execute({ ...request, sql: floored }).catch((error) => {
      // A twin not provisioned yet (rolling deploy) answers as the whole-history view would:
      // missing (unavailable), or created before its grant landed (provisioning incomplete).
      const twinNotReady =
        error instanceof LangWatchQLUnavailableError ||
        error instanceof LangWatchQLProvisioningIncompleteError;
      if (!twinNotReady) throw error;
      logger.warn(
        { refusal: error.code },
        "LangWatchQL floored view not readable yet; sent the statement as written",
      );
      return executor.execute(request);
    });
  }
}
