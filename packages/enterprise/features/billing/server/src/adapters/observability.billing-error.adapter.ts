// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger, type Logger } from "@langwatch/observability";
import { BillingErrorReporter } from "../ports/error-reporter.port";

const defaultLogger = createLogger("langwatch:billing:errorReporter");

/**
 * Where a billing handler's unexpected failure is reported in a process that
 * has no product-analytics client.
 *
 * The App reports these through PostHog's exception capture, which is an
 * App-and-browser capability: it is loaded from `posthog-js` and falls back to
 * a lazily required server instance the App owns. A background worker has
 * neither, and giving it a second PostHog client would put a product-analytics
 * dependency into a process whose only reader is the observability pipeline.
 *
 * So the report is an error LOG carrying the same error and the same context
 * keys, which the worker's own log export already collects. The difference is
 * deliberate and worth stating plainly: an exception raised in this process
 * does not appear in PostHog. It appears in the logs, under the same
 * `handler`, `organizationId` and `billingMonth` fields the capture carried.
 */
export class ObservabilityBillingErrorAdapter extends BillingErrorReporter {
  static create(target: Pick<Logger, "error"> = defaultLogger): ObservabilityBillingErrorAdapter {
    return new ObservabilityBillingErrorAdapter(target);
  }

  private constructor(private readonly target: Pick<Logger, "error">) {
    super();
  }

  capture(error: Error, context?: Record<string, unknown>): void {
    this.target.error({ ...context, error }, "billing handler reported an unexpected failure");
  }
}
