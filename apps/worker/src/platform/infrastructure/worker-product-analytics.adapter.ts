import { createLogger, type Logger } from "@langwatch/observability";
import { TraceProductAnalyticsPort, type TraceProductEvent } from "@langwatch/trace-server";

/**
 * A NAMED ABSENCE, not a product-analytics sink.
 *
 * The application sends the ingest path's one product event —
 * `first_trace_integrated`, at most once per project, the terminal step of the
 * onboarding funnel — to PostHog through `trackServerEvent`. This process has
 * no PostHog client, and acquiring one for a single event is a vendor
 * dependency this slice has no mandate to add.
 *
 * So the event is written to the log, loudly and with its whole payload, and
 * this class says in its own name and message that it is not delivery. The
 * alternative was a silent no-op, and a silent no-op here does not degrade the
 * way an unconfigured PostHog does: the application's no-op happens on
 * deployments that chose not to run product analytics, whereas this one would
 * happen on the deployment that does run it, undercounting the funnel forever
 * with nothing anywhere to show it.
 *
 * THE TRACE CONVERSION MUST REPLACE THIS BEFORE MOUNTING `projectMetadata`.
 * Either the process gets a real capture client, or the event moves to a
 * surface that already has one.
 */
export class WorkerLoggedProductAnalyticsAdapter extends TraceProductAnalyticsPort {
  static create(logger?: Logger): WorkerLoggedProductAnalyticsAdapter {
    return new WorkerLoggedProductAnalyticsAdapter(
      logger ?? createLogger("langwatch:worker:product-analytics"),
    );
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  record(event: TraceProductEvent): void {
    this.logger.warn(
      {
        userId: event.userId,
        productEvent: event.event,
        projectId: event.projectId,
        properties: event.properties,
      },
      "Product event was recorded to the log only: this process has no product-analytics sink",
    );
  }
}
