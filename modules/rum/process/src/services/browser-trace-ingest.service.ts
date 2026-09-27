import { createLogger, type Logger } from "@langwatch/observability";
import { RUM_MAX_SPANS } from "@langwatch/react-rum/constants";
import {
  type BrowserTraceReport,
  RumIngestDisabledError,
  RumPayloadInvalidError,
  RumPayloadTooLargeError,
  RumRateLimitedError,
} from "@langwatch/rum-contract";

import type { RumCollectorChannel } from "../channels/rum-collector.channel.ts";
import type { RumRateLimitRepository } from "../repositories/rum-rate-limit.repository.ts";
import {
  countSpans,
  parseTraceExport,
  withPlatformIdentity,
} from "../rules/browser-trace-export.rules.ts";
import {
  RUM_GLOBAL_PER_MINUTE,
  RUM_GLOBAL_RATE_LIMIT_KEY,
  RUM_PER_CALLER_PER_MINUTE,
  RUM_RATE_LIMIT_WINDOW_SECONDS,
  rumCallerKey,
  rumCallerRateLimitKey,
} from "../rules/rum-ingest.rules.ts";

/** Whether this deployment names a collector, and the channel to it when it does. */
export type RumCollector =
  | Readonly<{ configured: true; channel: RumCollectorChannel }>
  | Readonly<{ configured: false }>;

/**
 * Accepts one browser trace export and forwards it. The payload is untrusted:
 * the service bounds what it may cost and overwrites what it may claim. See
 * modules/rum/specs/browser-telemetry-ingest.feature and ADR-058.
 */
export class BrowserTraceIngestService {
  readonly #rateLimits: RumRateLimitRepository;
  readonly #collector: RumCollector;
  readonly #logger: Pick<Logger, "warn">;

  private constructor(
    rateLimits: RumRateLimitRepository,
    collector: RumCollector,
    logger: Pick<Logger, "warn">,
  ) {
    this.#rateLimits = rateLimits;
    this.#collector = collector;
    this.#logger = logger;
  }

  static create({
    rateLimits,
    collector,
    logger = createLogger("langwatch:rum:ingest"),
  }: Readonly<{
    rateLimits: RumRateLimitRepository;
    collector: RumCollector;
    logger?: Pick<Logger, "warn">;
  }>): BrowserTraceIngestService {
    return new BrowserTraceIngestService(rateLimits, collector, logger);
  }

  async ingest(report: BrowserTraceReport): Promise<void> {
    if (!this.#collector.configured) throw new RumIngestDisabledError();

    await this.#enforceRateLimits(rumCallerKey(report));

    const parsed = parseTraceExport(report.body);
    if (!parsed.walkable) throw new RumPayloadInvalidError();

    const spans = countSpans(parsed.traceExport.resourceSpans);
    if (spans === 0) throw new RumPayloadInvalidError();
    if (spans > RUM_MAX_SPANS) throw new RumPayloadTooLargeError("Too many spans");

    // Not awaited: the browser never learns the outcome, so waiting would only
    // hold its connection open for as long as a failing collector takes.
    void this.#forward(
      this.#collector.channel,
      JSON.stringify(withPlatformIdentity(parsed.traceExport)),
    );
  }

  /** The shared bucket first: checking the caller's first would mint a key per rotated identity. */
  async #enforceRateLimits(callerKey: string): Promise<void> {
    const global = await this.#rateLimits.limit({
      key: RUM_GLOBAL_RATE_LIMIT_KEY,
      windowSeconds: RUM_RATE_LIMIT_WINDOW_SECONDS,
      max: RUM_GLOBAL_PER_MINUTE,
    });
    if (!global.allowed) throw new RumRateLimitedError();

    const perCaller = await this.#rateLimits.limit({
      key: rumCallerRateLimitKey(callerKey),
      windowSeconds: RUM_RATE_LIMIT_WINDOW_SECONDS,
      max: RUM_PER_CALLER_PER_MINUTE,
    });
    if (!perCaller.allowed) throw new RumRateLimitedError();
  }

  /** A failure stays in the logs: a 5xx is OTLP-retryable and would start a retry storm. */
  async #forward(channel: RumCollectorChannel, traceExport: string): Promise<void> {
    try {
      const answer = await channel.send(traceExport);
      if (!answer.accepted) {
        this.#logger.warn({ status: answer.status }, "collector rejected browser telemetry");
      }
    } catch (error) {
      this.#logger.warn({ error }, "could not forward browser telemetry");
    }
  }
}
