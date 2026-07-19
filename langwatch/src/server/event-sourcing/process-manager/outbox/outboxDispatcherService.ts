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
  tracer?: Tracer;
  logger?: Logger;
}

export interface DispatchReport {
  dispatched: string[];
  retried: string[];
  dead: string[];
}

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const SLOW_OUTBOX_DELIVERY_MS = 10_000;

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
  private readonly tracer: Tracer;
  private readonly logger: Logger;

  constructor(options: OutboxDispatcherServiceOptions) {
    this.store = options.store;
    this.handlers = options.handlers;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.processNames = options.processNames;
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

    const report: DispatchReport = { dispatched: [], retried: [], dead: [] };
    for (const message of leased) {
      await this.dispatchOne({ message, now: params.now, report });
    }
    return report;
  }

  private async dispatchOne(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, report } = params;
    const attempt = message.attempts + 1;
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
          await this.store.markDispatched({
            identity,
            leaseToken: message.leaseToken,
            now,
          });
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
          const dead = attempt >= this.maxAttempts;
          const retryDelayMs = Math.max(
            this.retryDelayMs({ attempt }),
            retryAfterMsOf(error) ?? 0,
          );
          await this.store.markFailed({
            identity,
            leaseToken: message.leaseToken,
            now,
            nextAttemptAt: now + retryDelayMs,
            dead,
          });
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
