import { createLogger, type Logger } from "@langwatch/observability";
import { type TraceProductAnalytics, type TraceProductEvent } from "@langwatch/trace-server";
import { PostHog } from "posthog-node";
import type { WorkerProductAnalyticsConfig } from "../config/worker.config.ts";

/**
 * Product-analytics sink: worker twin of platform/app/src/server/posthog.ts, verbatim on the
 * wire. Key-absent is a no-op (same decision from same input as the app).
 */
export class WorkerPostHogProductAnalyticsAdapter implements TraceProductAnalytics {
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
  ) {}

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

  /** Flushes what is queued; the client batches, so exit without this drops pending events. */
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
