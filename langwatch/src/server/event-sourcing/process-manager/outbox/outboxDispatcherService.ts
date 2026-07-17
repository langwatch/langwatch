import {
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api";

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
}

export interface DispatchReport {
  dispatched: string[];
  retried: string[];
  dead: string[];
}

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LEASE_DURATION_MS = 30_000;

function defaultRetryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 60_000);
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

  constructor(options: OutboxDispatcherServiceOptions) {
    this.store = options.store;
    this.handlers = options.handlers;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.processNames = options.processNames;
    this.tracer =
      options.tracer ?? trace.getTracer("langwatch.process-manager");
  }

  async runOnce(params: { now: number; limit?: number }): Promise<DispatchReport> {
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
    const remoteParent = propagation.extract(ROOT_CONTEXT, message.traceCarrier);

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
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          const dead = attempt >= this.maxAttempts;
          await this.store.markFailed({
            identity,
            leaseToken: message.leaseToken,
            now,
            nextAttemptAt: now + this.retryDelayMs({ attempt }),
            dead,
          });
          (dead ? report.dead : report.retried).push(message.messageKey);
        } finally {
          span.end();
        }
      },
    );
  }
}
