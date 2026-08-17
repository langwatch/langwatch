import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
import {
  type Attributes,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import {
  incrementEsProcessIntentsSuppressed,
  incrementEsProcessManagerTotal,
  observeEsProcessManagerDuration,
} from "~/server/metrics";
import { toSafeFailureDiagnostic } from "./failureDiagnostic";
import { ensureJsonSafe } from "./json";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessIntent,
  ProcessRef,
} from "./processManager.types";
import type {
  DueWake,
  NewOutboxMessage,
  ProcessStore,
} from "./stores/processStore.types";

export type HandleResult =
  | {
      outcome: "committed";
      revision: number;
      insertedMessageKeys: string[];
      duplicateMessageKeys: string[];
    }
  | { outcome: "duplicateEvent" }
  | { outcome: "staleWake" }
  | { outcome: "revisionConflict"; actualRevision: number };

const SLOW_PROCESS_MANAGER_OPERATION_MS = 1_000;

/**
 * Structural equality over process state, which is JSON by contract.
 *
 * Key ORDER must not decide this: handlers build their result by spreading
 * the previous state, and a spread that reaches the same values by a
 * different insertion order is the same state. A serialise-and-compare would
 * call those different and quietly write an instance row per event, which is
 * the exact cost the transient path exists to avoid.
 */
function isDeepJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => isDeepJsonEqual(item, b[index]));
  }
  if (typeof a !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) =>
      Object.hasOwn(right, key) && isDeepJsonEqual(left[key], right[key]),
  );
}

export interface ProcessManagerServiceOptions<State> {
  definition: ProcessDefinition<State>;
  store: ProcessStore;
  tracer?: Tracer;
}

/**
 * Generic process-manager core (ADR-049 §4–5). Consumes committed queue
 * events and due wake-ups, runs the pure process definition, and commits the
 * transition together with its intents through the ProcessStore port.
 *
 * Idempotency contracts:
 * - a duplicate sourceEventId is a no-op (inbox);
 * - a duplicate messageKey is skipped, never re-inserted (outbox);
 * - a wake-up whose scheduling revision no longer matches is a no-op.
 */
export class ProcessManagerService<State> {
  private readonly definition: ProcessDefinition<State>;
  private readonly store: ProcessStore;
  private readonly tracer: Tracer;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:process-manager",
  );

  constructor(options: ProcessManagerServiceOptions<State>) {
    this.definition = options.definition;
    this.store = options.store;
    this.tracer =
      options.tracer ?? trace.getTracer("langwatch.process-manager");
  }

  async handleEvent(params: {
    envelope: ProcessEventEnvelope;
    now: number;
  }): Promise<HandleResult> {
    const { envelope, now } = params;
    const ref: ProcessRef = {
      processName: this.definition.name,
      projectId: envelope.projectId,
      processKey: envelope.processKey,
    };

    return await this.inEvolveSpan({
      inputKind: "event",
      // Intentionally retain this opaque operational ID for event-delivery diagnostics.
      logContext: {
        processKey: ref.processKey,
        projectId: envelope.projectId,
        tenantId: envelope.tenantId,
        userId: envelope.userId,
        sourceEventId: envelope.eventId,
        eventType: envelope.eventType,
      },
      attributes: {
        "process.name": ref.processName,
        "process.key": ref.processKey,
        "process.source_event_id": envelope.eventId,
        "process.input_kind": "event",
        "event.type": envelope.eventType,
        "tenant.id": envelope.tenantId,
        "project.id": envelope.projectId,
        ...(envelope.userId ? { "user.id": envelope.userId } : {}),
      },
      run: async () => {
        const existing = await this.store.findByRef<State>({ ref });
        const evolution = this.definition.evolve({
          previousState: existing?.state ?? this.definition.initialState,
          input: { kind: "event", event: envelope, now },
          ref,
        });

        // The transient path is decided AFTER the evolution has run against
        // the real previous state, never speculated on the initial one.
        //
        // Speculating looked cheaper — it skips this read — but it is not
        // sound: a handler may preserve its state while deriving its INTENT
        // from that state, which comes back looking initial-and-wakeless
        // while producing the wrong intents. Whether that shape exists today
        // is not the point; nothing stops the next author writing it, and it
        // would fail silently by dropping work.
        //
        // Reading first costs one indexed lookup. The savings that motivated
        // this path — no transaction, no advisory lock, no compare-and-swap,
        // no instance row, no inbox row — are all still here.
        if (
          this.definition.transient &&
          existing === null &&
          this.isTransientEvolution(evolution)
        ) {
          return await this.appendIntents({
            ref,
            tenantId: envelope.tenantId,
            userId: envelope.userId,
            sourceEventId: envelope.eventId,
            evolution,
            now,
          });
        }

        return await this.commitEvolution({
          ref,
          tenantId: envelope.tenantId,
          userId: envelope.userId,
          sourceEventId: envelope.eventId,
          expectedRevision: existing?.revision ?? 0,
          evolution,
          now,
        });
      },
    });
  }

  async handleWake(params: {
    wake: DueWake;
    now: number;
  }): Promise<HandleResult> {
    const { wake, now } = params;

    return await this.inEvolveSpan({
      inputKind: "wake",
      logContext: {
        processKey: wake.ref.processKey,
        projectId: wake.ref.projectId,
        wakeRevision: wake.revision,
      },
      attributes: {
        "process.name": wake.ref.processName,
        "process.key": wake.ref.processKey,
        "process.input_kind": "wake",
        "process.wake_revision": wake.revision,
        "project.id": wake.ref.projectId,
      },
      run: async () => {
        const existing = await this.store.findByRef<State>({ ref: wake.ref });
        // A wake-up is only valid for the exact revision it was scheduled
        // at. Any newer commit (durable activity, completion, archive, a
        // newer turn) supersedes it — the stale wake stands down.
        if (!existing || existing.revision !== wake.revision) {
          return { outcome: "staleWake" as const };
        }

        const evolution = this.definition.evolve({
          previousState: existing.state,
          input: { kind: "wake", scheduledFor: wake.wakeAt, now },
          ref: wake.ref,
        });

        return await this.commitEvolution({
          ref: wake.ref,
          tenantId: existing.tenantId,
          userId: existing.userId,
          sourceEventId: null,
          expectedRevision: existing.revision,
          evolution,
          now,
        });
      },
    });
  }

  /**
   * Whether this evolution left nothing behind worth reading back: still the
   * initial state, and no wake armed. Such an evolution's only output is its
   * intents, so it needs neither an instance row nor the transaction that
   * would keep one consistent with an inbox marker.
   */
  private isTransientEvolution(
    evolution: ReturnType<ProcessDefinition<State>["evolve"]>,
  ): boolean {
    return (
      evolution.nextWakeAt === null &&
      isDeepJsonEqual(evolution.state, this.definition.initialState)
    );
  }

  /**
   * The transient commit: intents only, no transaction. Mirrors
   * {@link commitEvolution}'s reporting so callers cannot tell which path a
   * process took, beyond the revision staying at 0 because nothing persisted.
   */
  private async appendIntents(params: {
    ref: ProcessRef;
    tenantId: string;
    userId?: string;
    sourceEventId: string;
    evolution: ReturnType<ProcessDefinition<State>["evolve"]>;
    now: number;
  }): Promise<HandleResult> {
    const messages = this.outboxMessagesFor({
      intents: params.evolution.intents,
      userId: params.userId,
    });

    const result = await this.store.appendIntents({
      ref: params.ref,
      tenantId: params.tenantId,
      ...(params.userId ? { userId: params.userId } : {}),
      sourceEventId: params.sourceEventId,
      messages,
      now: params.now,
    });

    if (result.duplicateMessageKeys.length > 0) {
      incrementEsProcessIntentsSuppressed({
        processName: params.ref.processName,
        count: result.duplicateMessageKeys.length,
      });
      // On this path a duplicate is the EXPECTED shape of a redelivery — it
      // is the suppression standing in for the inbox marker that is not
      // written. Still logged, for the same reason the durable path logs it:
      // a process that believes work is in flight while nothing was enqueued
      // looks identical from the outside.
      this.logger.info(
        {
          processName: params.ref.processName,
          processKey: params.ref.processKey,
          projectId: params.ref.projectId,
          tenantId: params.tenantId,
          sourceEventId: params.sourceEventId,
          duplicateMessageKeys: result.duplicateMessageKeys,
          insertedCount: result.insertedMessageKeys.length,
        },
        "Transient process append suppressed already-enqueued intents",
      );
    }

    return {
      outcome: "committed",
      // Nothing was persisted, so there is no revision to report. Zero is the
      // same value a first-time reader of this key would compute.
      revision: 0,
      insertedMessageKeys: result.insertedMessageKeys,
      duplicateMessageKeys: result.duplicateMessageKeys,
    };
  }

  private async commitEvolution(params: {
    ref: ProcessRef;
    tenantId: string;
    userId?: string;
    sourceEventId: string | null;
    expectedRevision: number;
    evolution: ReturnType<ProcessDefinition<State>["evolve"]>;
    now: number;
  }): Promise<HandleResult> {
    const { ref, evolution } = params;

    // The generic persistence boundary guarantees representation safety. The
    // application adapter owns the domain-specific content boundary by only
    // exposing typed, content-stripped state and intent payloads.
    ensureJsonSafe(evolution.state);
    ensureJsonSafe(evolution.nextWakeAt);

    const messages = this.outboxMessagesFor({
      intents: evolution.intents,
      userId: params.userId,
    });

    const result = await this.store.commit({
      ref,
      tenantId: params.tenantId,
      userId: params.userId,
      sourceEventId: params.sourceEventId,
      expectedRevision: params.expectedRevision,
      state: evolution.state,
      nextWakeAt: evolution.nextWakeAt,
      messages,
      now: params.now,
    });

    if (
      result.outcome === "committed" &&
      result.duplicateMessageKeys.length > 0
    ) {
      incrementEsProcessIntentsSuppressed({
        processName: ref.processName,
        count: result.duplicateMessageKeys.length,
      });
      // The state commit succeeded but one or more intents were suppressed as
      // already-dispatched. That is legitimate idempotency on redelivery, and
      // it is ALSO how a scheduling bug hides: the process believes work is in
      // flight while nothing was ever enqueued. Never let it pass silently.
      this.logger.warn(
        {
          processName: ref.processName,
          processKey: ref.processKey,
          projectId: ref.projectId,
          tenantId: params.tenantId,
          sourceEventId: params.sourceEventId,
          duplicateMessageKeys: result.duplicateMessageKeys,
          insertedCount: result.insertedMessageKeys.length,
        },
        "Process-manager commit suppressed already-dispatched intents",
      );
    }

    return result;
  }

  /**
   * The outbox rows one evolution's intents become, for either commit path.
   *
   * Shared rather than written twice: the transient append and the durable
   * commit build the same row, so a field added to one and not the other is
   * a message that behaves differently depending on which path minted it.
   */
  private outboxMessagesFor({
    intents,
    userId,
  }: {
    intents: ProcessIntent[];
    userId?: string;
  }): NewOutboxMessage[] {
    const traceCarrier = this.captureTraceCarrier();
    return intents.map((intent) => {
      ensureJsonSafe(intent.payload);
      return {
        messageKey: intent.messageKey,
        intentType: intent.intentType,
        payload: intent.payload,
        traceCarrier,
        ...(userId ? { userId } : {}),
      };
    });
  }

  /**
   * Captures the full active W3C propagation carrier
   * (traceparent/tracestate/baggage as configured on the global propagator)
   * so the outbox dispatch can continue this trace as its remote parent.
   */
  private captureTraceCarrier(): Record<string, string> {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
  }

  private async inEvolveSpan<T extends HandleResult>(params: {
    inputKind: "event" | "wake";
    logContext: Record<string, string | number | undefined>;
    attributes: Attributes;
    run: () => Promise<T>;
  }): Promise<T> {
    return await this.tracer.startActiveSpan(
      `process ${this.definition.name} evolve`,
      { kind: SpanKind.INTERNAL, attributes: params.attributes },
      async (span) => {
        const startedAt = performance.now();
        try {
          const result = await params.run();
          const outcome =
            (result as HandleResult).outcome === "duplicateEvent"
              ? "duplicate_event"
              : (result as HandleResult).outcome === "staleWake"
                ? "stale_wake"
                : (result as HandleResult).outcome === "revisionConflict"
                  ? "revision_conflict"
                  : "committed";
          incrementEsProcessManagerTotal({
            processName: this.definition.name,
            inputKind: params.inputKind,
            outcome,
          });
          if (outcome === "revision_conflict") {
            this.logger.warn(
              {
                processName: this.definition.name,
                inputKind: params.inputKind,
                outcome,
                ...params.logContext,
              },
              "Process-manager evolution hit a revision conflict",
            );
          }
          return result;
        } catch (error) {
          incrementEsProcessManagerTotal({
            processName: this.definition.name,
            inputKind: params.inputKind,
            outcome: "failed",
          });
          const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
          span.recordException({
            name: errorType,
            message: errorMessage,
          });
          span.setStatus({ code: SpanStatusCode.ERROR });
          this.logger.error(
            {
              processName: this.definition.name,
              inputKind: params.inputKind,
              errorType,
              errorMessage,
              ...params.logContext,
            },
            "Process-manager evolution failed",
          );
          throw error;
        } finally {
          const durationMs = performance.now() - startedAt;
          observeEsProcessManagerDuration({
            processName: this.definition.name,
            inputKind: params.inputKind,
            durationMs,
          });
          if (durationMs >= SLOW_PROCESS_MANAGER_OPERATION_MS) {
            this.logger.warn(
              {
                processName: this.definition.name,
                inputKind: params.inputKind,
                durationMs: Math.round(durationMs),
                ...params.logContext,
              },
              "Process-manager evolution is slow",
            );
          }
          span.end();
        }
      },
    );
  }
}
