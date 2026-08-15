import { performance } from "node:perf_hooks";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import {
  incrementEsProcessOutboxTotal,
  observeEsProcessOutboxDispatchLag,
  observeEsProcessOutboxDuration,
} from "~/server/metrics";
import { toSafeFailureDiagnostic } from "../failureDiagnostic";
import type { JsonValue } from "../json";
import type {
  LeasedOutboxMessageRecord,
  ProcessStore,
} from "../stores/processStore.types";

/** What an intent handler receives: identity + payload, never store rows. */
export interface DispatchableMessage {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  userId?: string;
  messageKey: string;
  intentType: string;
  payload: JsonValue;
  sourceEventId: string | null;
  /** 1-based delivery attempt. */
  attempt: number;
}

/**
 * Delivery is at-least-once: a crash between a successful handler call and
 * markDispatched redelivers the same messageKey, so handlers must be
 * idempotent on it.
 */
export type IntentHandler = (params: {
  message: DispatchableMessage;
}) => Promise<void>;

export interface OutboxDispatcherServiceOptions {
  store: ProcessStore;
  /** One handler per intentType. Unhandled types are retried, not dropped. */
  handlers: Record<string, IntentHandler>;
  /** Delivery attempts before a message is retired as dead. Default 10. */
  maxAttempts?: number;
  /** Backoff for the attempt that just failed. Default: exponential, capped. */
  retryDelayMs?: (params: { attempt: number }) => number;
  /** How long a leased message stays invisible to other loops. Default 30s. */
  leaseDurationMs?: number;
  /**
   * Which processNames this dispatcher serves. The outbox table is shared
   * across domains, so every domain-scoped dispatcher must set this — an
   * unfiltered dispatcher leases other domains' intents and retry-churns
   * them for lack of a handler. Omitted means unfiltered.
   */
  processNames?: readonly string[];
  /**
   * How many leased messages this dispatcher may have in flight at once.
   * Default 1 (strictly sequential), which is what every caller got before
   * this option existed. Raise it only for a domain whose effect is slow and
   * genuinely parallel-safe. The lease fences each message individually, but
   * NOTHING serializes two pending messages for the same processKey within a
   * batch — they dispatch concurrently and in no guaranteed order — so above
   * 1 the domain must also guarantee at most one in-flight intent per key by
   * construction (as topic clustering's in-flight guard and one-page-at-a-
   * time chaining do), or tolerate reordering.
   */
  concurrency?: number;
  /**
   * Wall clock for measuring elapsed time inside one drain (the lease
   * budget check). Distinct from runOnce's `now`, which is the batch's
   * logical time for lease and lag math. Injectable so fake-timer tests
   * control both.
   */
  clock?: () => number;
  tracer?: Tracer;
  logger?: Logger;
}

export interface DispatchReport {
  dispatched: string[];
  retried: string[];
  dead: string[];
  /** Returned to the pool un-attempted: the batch ran out of lease budget. */
  released: string[];
  /** Acknowledgements that matched no row — the lease lapsed mid-delivery. */
  fenced: string[];
}

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const SLOW_OUTBOX_DELIVERY_MS = 10_000;
/** Never start a delivery with less lease budget left than this. */
const LEASE_SAFETY_MARGIN_CAP_MS = 10_000;
const LEASE_SAFETY_MARGIN_FRACTION = 0.2;

function defaultRetryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 60_000);
}

function retryAfterMsOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const retryAfterMs = Reflect.get(error, "retryAfterMs");
  return typeof retryAfterMs === "number" &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
    ? retryAfterMs
    : undefined;
}

/**
 * A handler can mark an error as not worth retrying by throwing with
 * `retryable: false` (DispatchError's shape, same classification the queue
 * path honors): the message retires as dead on this attempt instead of
 * burning the remaining ladder against a permanent failure, e.g. a webhook
 * receiver answering 404.
 */
function isTerminalError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "retryable") === false;
}

/**
 * Leases due process-outbox messages and dispatches each inside a CONSUMER
 * span whose remote parent is restored from the message's persisted W3C
 * carrier. This keeps the effect on the trace that committed its intent,
 * including across process restarts and retries.
 */
export class OutboxDispatcherService {
  private readonly store: ProcessStore;
  private readonly handlers: Record<string, IntentHandler>;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (params: { attempt: number }) => number;
  private readonly leaseDurationMs: number;
  private readonly processNames: readonly string[] | undefined;
  private readonly concurrency: number;
  private readonly clock: () => number;
  private readonly leaseSafetyMarginMs: number;
  private readonly tracer: Tracer;
  private readonly logger: Logger;

  constructor(options: OutboxDispatcherServiceOptions) {
    this.store = options.store;
    this.handlers = options.handlers;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.processNames = options.processNames;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.clock = options.clock ?? Date.now;
    this.leaseSafetyMarginMs = Math.min(
      this.leaseDurationMs * LEASE_SAFETY_MARGIN_FRACTION,
      LEASE_SAFETY_MARGIN_CAP_MS,
    );
    this.tracer =
      options.tracer ?? trace.getTracer("langwatch.process-manager");
    this.logger =
      options.logger ?? createLogger("langwatch:event-sourcing:process-outbox");
  }

  async runOnce(params: {
    now: number;
    limit?: number;
  }): Promise<DispatchReport> {
    const leased = await this.store.leaseDueMessages({
      now: params.now,
      limit: params.limit ?? 10,
      leaseDurationMs: this.leaseDurationMs,
      ...(this.processNames ? { processNames: this.processNames } : {}),
    });
    const leaseStartedAt = this.clock();

    const report: DispatchReport = {
      dispatched: [],
      retried: [],
      dead: [],
      released: [],
      fenced: [],
    };
    if (this.concurrency <= 1) {
      for (const message of leased) {
        await this.dispatchOrShed({
          message,
          now: params.now,
          leaseStartedAt,
          report,
        });
      }
      return report;
    }

    // Bounded pool over the leased batch. Each message is independently
    // lease-fenced, so the only thing being bounded here is concurrent load on
    // whatever the handlers call.
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.concurrency, leased.length) },
      async () => {
        while (cursor < leased.length) {
          const message = leased[cursor++]!;
          await this.dispatchOrShed({
            message,
            now: params.now,
            leaseStartedAt,
            report,
          });
        }
      },
    );
    await Promise.all(workers);
    return report;
  }

  /**
   * The two checks that keep a slow batch honest, applied before each
   * delivery starts (issue #7016):
   *
   * Retirement — leasing increments `attempts`, so a message whose earlier
   * deliveries never acknowledged (lease lapsed every time) eventually
   * arrives here past `maxAttempts` and retires as dead WITHOUT running the
   * handler again. Before this check such a message redelivered forever.
   *
   * Lease budget — the batch was leased up front, so a message deep in a
   * slow batch may reach its turn with the shared lease nearly spent.
   * Starting it would guarantee its acknowledgement is fenced and the
   * effect runs twice; releasing it un-attempted keeps every delivery
   * inside its lease.
   */
  private async dispatchOrShed(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    leaseStartedAt: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, leaseStartedAt, report } = params;
    const identity = {
      processName: message.processName,
      projectId: message.projectId,
      messageKey: message.messageKey,
    };

    if (message.attempts > this.maxAttempts) {
      const { applied } = await this.store.markFailed({
        identity,
        leaseToken: message.leaseToken,
        now,
        nextAttemptAt: now,
        dead: true,
      });
      if (!applied) {
        this.countFenced({ message, report, phase: "retirement" });
        return;
      }
      report.dead.push(message.messageKey);
      incrementEsProcessOutboxTotal({
        processName: message.processName,
        intentType: message.intentType,
        status: "dead",
      });
      this.logger.error(
        {
          processName: message.processName,
          processKey: message.processKey,
          projectId: message.projectId,
          tenantId: message.tenantId,
          messageKey: message.messageKey,
          intentType: message.intentType,
          attempts: message.attempts,
        },
        "Process-manager outbox message exhausted its attempts without ever " +
          "acknowledging — retiring it as dead. Its handler is either not " +
          "settling or repeatedly outliving the lease.",
      );
      return;
    }

    const elapsedMs = this.clock() - leaseStartedAt;
    if (this.leaseDurationMs - elapsedMs < this.leaseSafetyMarginMs) {
      const { applied } = await this.store.releaseLease({
        identity,
        leaseToken: message.leaseToken,
        now,
      });
      if (applied) {
        report.released.push(message.messageKey);
        incrementEsProcessOutboxTotal({
          processName: message.processName,
          intentType: message.intentType,
          status: "released",
        });
      }
      this.logger.debug(
        {
          processName: message.processName,
          messageKey: message.messageKey,
          intentType: message.intentType,
          elapsedMs: Math.round(elapsedMs),
          leaseDurationMs: this.leaseDurationMs,
          applied,
        },
        "Released a leased outbox message un-attempted; the batch ran out of lease budget",
      );
      return;
    }

    await this.dispatchOne({ message, now, report });
  }

  private countFenced(params: {
    message: LeasedOutboxMessageRecord;
    report: DispatchReport;
    phase: "dispatched" | "failed" | "retirement";
    durationMs?: number;
  }): void {
    const { message, report, phase, durationMs } = params;
    report.fenced.push(message.messageKey);
    incrementEsProcessOutboxTotal({
      processName: message.processName,
      intentType: message.intentType,
      status: "fenced",
    });
    this.logger.warn(
      {
        processName: message.processName,
        processKey: message.processKey,
        projectId: message.projectId,
        tenantId: message.tenantId,
        messageKey: message.messageKey,
        intentType: message.intentType,
        attempt: message.attempts,
        phase,
        ...(durationMs !== undefined
          ? { durationMs: Math.round(durationMs) }
          : {}),
      },
      "Process-manager outbox acknowledgement was fenced by a lapsed lease — " +
        "another dispatcher superseded it and the effect may have run more " +
        "than once; message-key idempotency in the handler absorbs the " +
        "duplicate",
    );
  }

  private async dispatchOne(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, report } = params;
    // Leasing already incremented `attempts`, so the leased record carries
    // this delivery's 1-based attempt number.
    const attempt = message.attempts;
    const identity = {
      processName: message.processName,
      projectId: message.projectId,
      messageKey: message.messageKey,
    };
    const remoteParent = propagation.extract(
      ROOT_CONTEXT,
      message.traceCarrier,
    );

    await this.tracer.startActiveSpan(
      `process ${message.processName} dispatch ${message.intentType}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "process.name": message.processName,
          "process.key": message.processKey,
          "process.source_event_id": message.sourceEventId ?? undefined,
          "process.message_key": message.messageKey,
          "process.intent_type": message.intentType,
          "process.attempt": attempt,
          "tenant.id": message.tenantId,
          "project.id": message.projectId,
          ...(message.userId ? { "user.id": message.userId } : {}),
        },
      },
      remoteParent,
      async (span) => {
        const startedAt = performance.now();
        // Commit → first-dispatch delay (ADR-054): the substrate's direct
        // "is the outbox draining" signal. First attempt only — retries
        // re-enter with deliberate backoff, which is not queueing delay.
        if (attempt === 1) {
          observeEsProcessOutboxDispatchLag({
            processName: message.processName,
            lagMs: now - message.createdAt,
          });
        }
        try {
          const handler = this.handlers[message.intentType];
          if (!handler) {
            throw new Error(
              `No handler registered for intent type "${message.intentType}"`,
            );
          }
          await handler({
            message: {
              processName: message.processName,
              projectId: message.projectId,
              processKey: message.processKey,
              tenantId: message.tenantId,
              userId: message.userId,
              messageKey: message.messageKey,
              intentType: message.intentType,
              payload: message.payload,
              sourceEventId: message.sourceEventId,
              attempt,
            },
          });
          const { applied } = await this.store.markDispatched({
            identity,
            leaseToken: message.leaseToken,
            now,
          });
          if (!applied) {
            this.countFenced({
              message,
              report,
              phase: "dispatched",
              durationMs: performance.now() - startedAt,
            });
            return;
          }
          report.dispatched.push(message.messageKey);
          incrementEsProcessOutboxTotal({
            processName: message.processName,
            intentType: message.intentType,
            status: "dispatched",
          });
        } catch (error) {
          const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
          span.recordException({
            name: errorType,
            message: errorMessage,
          });
          span.setStatus({ code: SpanStatusCode.ERROR });
          const dead = attempt >= this.maxAttempts || isTerminalError(error);
          const retryDelayMs = Math.max(
            this.retryDelayMs({ attempt }),
            retryAfterMsOf(error) ?? 0,
          );
          const { applied } = await this.store.markFailed({
            identity,
            leaseToken: message.leaseToken,
            now,
            nextAttemptAt: now + retryDelayMs,
            dead,
          });
          if (!applied) {
            this.countFenced({
              message,
              report,
              phase: "failed",
              durationMs: performance.now() - startedAt,
            });
            return;
          }
          (dead ? report.dead : report.retried).push(message.messageKey);
          incrementEsProcessOutboxTotal({
            processName: message.processName,
            intentType: message.intentType,
            status: dead ? "dead" : "retried",
          });
          if (dead || attempt === 1) {
            // Intentionally retain this opaque operational ID for delivery diagnostics.
            const fields = {
              processName: message.processName,
              processKey: message.processKey,
              projectId: message.projectId,
              tenantId: message.tenantId,
              userId: message.userId,
              messageKey: message.messageKey,
              sourceEventId: message.sourceEventId,
              intentType: message.intentType,
              attempt,
              outcome: dead ? "dead" : "retry_scheduled",
              errorType,
              errorMessage,
            };
            if (dead) {
              this.logger.error(
                fields,
                "Process-manager outbox message exhausted delivery attempts",
              );
            } else {
              this.logger.warn(
                fields,
                "Process-manager outbox delivery failed; retry scheduled",
              );
            }
          }
        } finally {
          const durationMs = performance.now() - startedAt;
          observeEsProcessOutboxDuration({
            processName: message.processName,
            intentType: message.intentType,
            durationMs,
          });
          if (durationMs >= SLOW_OUTBOX_DELIVERY_MS) {
            // Intentionally retain this opaque operational ID for slow-delivery diagnostics.
            this.logger.warn(
              {
                processName: message.processName,
                processKey: message.processKey,
                projectId: message.projectId,
                tenantId: message.tenantId,
                userId: message.userId,
                messageKey: message.messageKey,
                sourceEventId: message.sourceEventId,
                intentType: message.intentType,
                attempt,
                durationMs: Math.round(durationMs),
              },
              "Process-manager outbox delivery is slow",
            );
          }
          span.end();
        }
      },
    );
  }
}
