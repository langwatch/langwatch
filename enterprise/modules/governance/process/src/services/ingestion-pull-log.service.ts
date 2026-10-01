// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";

import type { IngestionPullDiagnosticsSink } from "../app/governance.members.ts";

const logger = createLogger("langwatch:governance:ingestion-pull");

/** Where a run's progress and its failures are stated: the process log, as main's worker did. */
export class IngestionPullLogService implements IngestionPullDiagnosticsSink {
  private constructor() {}

  static create(): IngestionPullLogService {
    return new IngestionPullLogService();
  }

  info(message: string, context: Record<string, unknown>): void {
    logger.info(context, message);
  }

  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }

  error(message: string, context: Record<string, unknown>): void {
    logger.error(context, message);
  }

  capture(error: Error, context: Record<string, unknown>): void {
    logger.error({ ...context, error }, "governance ingestion pull failed");
  }
}
