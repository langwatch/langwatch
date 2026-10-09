// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";

export interface IngestionPullDiagnosticsSink {
  info(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
  capture(error: Error, context: Record<string, unknown>): void;
}

export const silentIngestionPullDiagnostics: IngestionPullDiagnosticsSink = {
  info: () => {},
  warn: () => {},
  error: () => {},
  capture: () => {},
};

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
