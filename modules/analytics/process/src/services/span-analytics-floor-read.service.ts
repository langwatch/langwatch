/**
 * Reads where span_analytics is complete, for the span-type reads that can use it. Asked only
 * when a read names a span type, so no other read pays the ledger lookup; a failed lookup answers
 * the unknown floor, which keeps that read on stored_spans instead of failing it.
 * @see specs/analytics/span-type-light-reads.feature
 */

import { createLogger, type Logger } from "@langwatch/observability";
import { type SpanAnalyticsFloor, UNKNOWN_SPAN_ANALYTICS_FLOOR } from "@langwatch/trace-contract";

export class SpanAnalyticsFloorReadService {
  private constructor(
    private readonly read: () => Promise<SpanAnalyticsFloor>,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  static create(options: {
    read: () => Promise<SpanAnalyticsFloor>;
    logger?: Pick<Logger, "warn"> | undefined;
  }): SpanAnalyticsFloorReadService {
    return new SpanAnalyticsFloorReadService(
      options.read,
      options.logger ?? createLogger("langwatch:analytics:span-analytics-floor"),
    );
  }

  /** The floor, or the unknown floor (stored_spans) when it cannot be read. */
  async floor(): Promise<SpanAnalyticsFloor> {
    try {
      return await this.read();
    } catch (error) {
      this.logger.warn(
        { error },
        "span_analytics floor unreadable; span types read from stored_spans",
      );
      return UNKNOWN_SPAN_ANALYTICS_FLOOR;
    }
  }

  /** The floor as a read's optional field, present only when `needed`. */
  async floorFieldFor(needed: boolean): Promise<{ spanAnalyticsFloor?: SpanAnalyticsFloor }> {
    return needed ? { spanAnalyticsFloor: await this.floor() } : {};
  }
}
