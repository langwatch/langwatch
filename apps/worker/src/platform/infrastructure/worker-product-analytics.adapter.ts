import { createLogger, type Logger } from "@langwatch/observability";
import { TraceProductAnalyticsPort, type TraceProductEvent } from "@langwatch/trace-server";
import { PostHog } from "posthog-node";
import type { WorkerProductAnalyticsConfig } from "../config/worker.config";

/**
 * The product-analytics sink for this process, as a vendor transport.
 *
 * This is the application's `platform/app/src/server/posthog.ts` verbatim in
 * everything that reaches the wire: the same lazy singleton keyed on
 * `POSTHOG_KEY`, the same host passed straight through, the same
 * fire-and-forget `capture` with the org admin's user id as `distinctId`, the
 * same conditional `projectId` spread, and the same shutdown that flushes what
 * is queued. Only the seams changed — it extends the port Trace declares
 * rather than exporting two module functions, and it takes the process's own
 * resolved configuration rather than reading `env.mjs`.
 *
 * ## Why a key-absent no-op is parity and not a gap
 *
 * The predecessor here logged the event and said in its own name that it was
 * not delivery, on the reasoning that a silent no-op in a background process
 * would undercount the funnel on the deployment that actually ran analytics.
 * That reasoning held only while the process could not read the key at all.
 * It now reads the same two variables the application reads, so the two halves
 * make the same decision from the same input: a deployment that named no
 * `POSTHOG_KEY` chose not to run product analytics and neither half records
 * anything, and a deployment that named one gets a real capture from whichever
 * graph owns the ingest path. Logging a "delivery" on the second deployment is
 * the undercount, which is why the logged adapter is deleted rather than kept
 * as a fallback.
 *
 * ## Why the import is top-level
 *
 * `posthog-node` is a hard dependency of this process, not an optional one, and
 * the application imports it top-level in the module this twins. The lazy
 * `import()` calls in `WorkerTiktokenCounterAdapter` are load-bearing for the
 * opposite reason — `tiktoken` is optional at runtime and stays external to the
 * production bundle — and that precedent does not reach here.
 */
export class WorkerPostHogProductAnalyticsAdapter extends TraceProductAnalyticsPort {
  static create(options: {
    config: WorkerProductAnalyticsConfig;
    logger?: Logger;
  }): WorkerPostHogProductAnalyticsAdapter {
    return new WorkerPostHogProductAnalyticsAdapter(
      options.config,
      options.logger ?? createLogger("langwatch:worker:product-analytics"),
    );
  }

  /**
   * Composed with an explicit client factory so the twin test can read the
   * arguments the vendor client would have been constructed with, and the
   * capture it would have been handed, without a network.
   */
  static createWithClientFactory(options: {
    config: WorkerProductAnalyticsConfig;
    logger?: Logger;
    createClient: (key: string, options: { host: string | undefined }) => ProductAnalyticsClient;
  }): WorkerPostHogProductAnalyticsAdapter {
    return new WorkerPostHogProductAnalyticsAdapter(
      options.config,
      options.logger ?? createLogger("langwatch:worker:product-analytics"),
      options.createClient,
    );
  }

  /** `undefined` = not built yet, `null` = built, and this deployment has no key. */
  private client: ProductAnalyticsClient | null | undefined;

  private constructor(
    private readonly config: WorkerProductAnalyticsConfig,
    private readonly logger: Logger,
    private readonly createClient: (
      key: string,
      options: { host: string | undefined },
    ) => ProductAnalyticsClient = (key, options) => new PostHog(key, options),
  ) {
    super();
  }

  /**
   * Fire and forget, and never at the expense of the trace.
   *
   * This runs inside a projection subscriber on the ingest path. A sink that
   * could throw would fail the trace that triggered it and the customer would
   * lose data over an analytics event, so the capture is guarded even though
   * the vendor client buffers in memory and is not supposed to throw.
   */
  record(event: TraceProductEvent): void {
    const client = this.tryGetClient();
    if (!client) return;

    try {
      client.capture({
        distinctId: event.userId,
        event: event.event,
        properties: {
          ...event.properties,
          ...(event.projectId ? { projectId: event.projectId } : {}),
        },
      });
    } catch (error) {
      // The event's properties are NOT logged: they are the customer's own,
      // and the application logs nothing here at all. This line says a
      // milestone was lost, not what it contained.
      this.logger.warn(
        {
          productEvent: event.event,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not record a product event; the onboarding funnel will undercount this project",
      );
    }
  }

  /**
   * Flushes what is queued.
   *
   * The client batches, so a process that exited without this would drop
   * whatever had not left yet — and the one event this path emits is emitted
   * at most once in a project's lifetime, so a dropped one is not re-sent by
   * anything. The application calls the same shutdown from its own graceful
   * sequence rather than from a signal handler of its own, and this is owned by
   * the composition's resource scope for the same reason.
   */
  async close(): Promise<void> {
    const client = this.client;
    if (!client) return;
    // Reset before awaiting so a later caller builds a fresh client rather
    // than receiving the shut-down one.
    this.client = undefined;
    await client.shutdown();
  }

  private tryGetClient(): ProductAnalyticsClient | null {
    if (this.client === undefined) {
      this.client = this.config.key
        ? this.createClient(this.config.key, { host: this.config.host })
        : null;
    }
    return this.client;
  }
}

/**
 * The two operations this capability performs on a capture client.
 *
 * Structural rather than a `PostHog` import at the seam: the real client
 * satisfies it, and so does a fake, which is what lets the twin test read the
 * exact capture that would have gone on the wire.
 */
export type ProductAnalyticsClient = {
  capture(input: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): unknown;
  shutdown(): Promise<void>;
};
