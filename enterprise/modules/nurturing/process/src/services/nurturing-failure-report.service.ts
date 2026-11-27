// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

const nurturingLogger = createLogger("langwatch:nurturing");

/**
 * Where a fire-and-forget lifecycle signal's failure goes, whichever sink it was for: the
 * Customer.io sender's calls and the delivery's PostHog, member-batch and usage-report sends.
 */
export class NurturingFailureReportService {
  /**
   * Warn rather than error, and swallowed rather than rethrown: the caller has already done the
   * thing the customer asked for, and a sink's outage is not the customer's problem.
   */
  static readonly reportFailure = (error: unknown): void => {
    nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
  };

  static create(): NurturingFailureReportService {
    return new NurturingFailureReportService();
  }

  private constructor() {}
}
