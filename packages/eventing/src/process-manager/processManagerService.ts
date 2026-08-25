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
} from "../metrics";
import { toSafeFailureDiagnostic } from "./failureDiagnostic";
import { ensureJsonSafe, isDeepJsonEqual } from "./json";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessIntent,
  ProcessRef,
  ProcessSignalEnvelope,
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

/**
 * Result of a synchronous external signal. Both successful variants include
 * a durable state: `committed` is the revision this call wrote, while
 * `duplicateSignal` is the state observed after an earlier call with the same
 * signal identity committed.
 */
export type SignalHandleResult<State> =
  | {
      outcome: "committed";
      state: State;
      revision: number;
      insertedMessageKeys: string[];
      duplicateMessageKeys: string[];
    }
  | { outcome: "duplicateSignal"; state: State; revision: number }
  | { outcome: "processNotFound" }
  | {
      outcome: "revisionConflict";
      actualRevision: number;
      state: State;
    };

const SLOW_PROCESS_MANAGER_OPERATION_MS = 1_000;
export const DEFAULT_SIGNAL_REVISION_RETRIES = 3;

export interface ProcessManagerServiceOptions<State> {
  definition: ProcessDefinition<State>;
  store: ProcessStore;
  tracer?: Tracer;
  /** Number of compare-and-swap losses a synchronous signal retries. */
  signalRevisionRetries?: number;
}

/**
 * Generic process-manager core (ADR-049 §4–5). Consumes committed queue
 * events and due wake-ups, runs the pure process definition, and commits the
 * transition together with its intents through the ProcessStore port.
 *
 * Idempotency contracts:
 * - a duplicate sourceEventId is a no-op (inbox);
 * - a duplicate signalId returns durable state without re-running evolution;
 * - a duplicate messageKey is skipped, never re-inserted (outbox);
 * - a wake-up whose scheduling revision no longer matches is a no-op.
 */
export class ProcessManagerService<State> {
  private readonly definition: ProcessDefinition<State>;
  private readonly store: ProcessStore;
  private readonly tracer: Tracer;
  private readonly signalRevisionRetries: number;
  private readonly logger = createLogger("langwatch:event-sourcing:process-manager");

  constructor(options: ProcessManagerServiceOptions<State>) {
    this.definition = options.definition;
    this.store = options.store;
    this.tracer = options.tracer ?? trace.getTracer("langwatch.process-manager");
    this.signalRevisionRetries =
      options.signalRevisionRetries ?? DEFAULT_SIGNAL_REVISION_RETRIES;
    if (
      !Number.isSafeInteger(this.signalRevisionRetries) ||
      this.signalRevisionRetries < 0
    ) {
      throw new RangeError("signalRevisionRetries must be a non-negative safe integer");
    }
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

  async handleWake(params: { wake: DueWake; now: number }): Promise<HandleResult> {
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
   * Advances an existing process synchronously through the same atomic
   * state/wake/inbox/outbox commit used by event and wake delivery.
   *
   * A signal CAS loss is retried against the winning revision. This is what
   * lets, for example, a request and a due wake compete for one transition:
   * the loser reloads and lets the pure domain handler decide whether the
   * new state permits, joins, or rejects the requested transition.
   */
  async handleSignal(params: {
    signal: ProcessSignalEnvelope;
    now: number;
    /** Explicitly allow this signal to establish the revision-1 instance. */
    createIfMissing?: boolean;
  }): Promise<SignalHandleResult<State>> {
    const { signal, now, createIfMissing = false } = params;
    const evolveSignal = this.definition.evolveSignal;
    if (!evolveSignal) {
      throw new Error(
        `Process manager "${this.definition.name}" does not accept external signals`,
      );
    }

    const ref: ProcessRef = {
      processName: this.definition.name,
      projectId: signal.projectId,
      processKey: signal.processKey,
    };

    return await this.inEvolveSpan({
      inputKind: "signal",
      logContext: {
        processKey: ref.processKey,
        projectId: ref.projectId,
        userId: signal.userId,
        signalId: signal.signalId,
        signalType: signal.signalType,
      },
      attributes: {
        "process.name": ref.processName,
        "process.key": ref.processKey,
        "process.input_kind": "signal",
        "process.signal_id": signal.signalId,
        "process.signal_type": signal.signalType,
        "project.id": ref.projectId,
        ...(signal.userId ? { "user.id": signal.userId } : {}),
      },
      run: async () => {
        ensureJsonSafe(signal.payload);
        const sourceEventId = `external-signal:${signal.signalId}`;

        for (
          let conflictCount = 0;
          conflictCount <= this.signalRevisionRetries;
          conflictCount++
        ) {
          if (await this.store.hasConsumedSource({ ref, sourceEventId })) {
            const winning = await this.store.findByRef<State>({ ref });
            if (!winning) return { outcome: "processNotFound" as const };
            return {
              outcome: "duplicateSignal" as const,
              state: winning.state,
              revision: winning.revision,
            };
          }

          const existing = await this.store.findByRef<State>({ ref });
          if (!existing && !createIfMissing) {
            return { outcome: "processNotFound" as const };
          }

          const evolution = evolveSignal({
            previousState: existing?.state ?? this.definition.initialState,
            signal,
            now,
            ref,
          });
          const result = await this.commitEvolution({
            ref,
            tenantId: existing?.tenantId ?? signal.projectId,
            userId: signal.userId ?? existing?.userId,
            sourceEventId,
            expectedRevision: existing?.revision ?? 0,
            evolution,
            now,
          });

          if (result.outcome === "committed") {
            return { ...result, state: evolution.state };
          }

          if (result.outcome === "duplicateEvent") {
            // The response to the first call may have been lost. Re-read so
            // the retry still receives a durable winning state.
            const winning = await this.store.findByRef<State>({ ref });
            if (!winning) return { outcome: "processNotFound" as const };
            return {
              outcome: "duplicateSignal" as const,
              state: winning.state,
              revision: winning.revision,
            };
          }

          if (result.outcome !== "revisionConflict") {
            throw new Error(
              `External signal produced unexpected outcome "${result.outcome}"`,
            );
          }

          if (conflictCount < this.signalRevisionRetries) continue;

          const winning = await this.store.findByRef<State>({ ref });
          if (!winning) return { outcome: "processNotFound" as const };
          return {
            outcome: "revisionConflict" as const,
            actualRevision: winning.revision,
            state: winning.state,
          };
        }

        // The loop always returns; this guards future edits to its bounds.
        throw new Error("External signal retry loop terminated unexpectedly");
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

    if (result.outcome === "committed" && result.duplicateMessageKeys.length > 0) {
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

  private async inEvolveSpan<T extends HandleResult | SignalHandleResult<State>>(params: {
    inputKind: "event" | "wake" | "signal";
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
            result.outcome === "duplicateEvent"
              ? "duplicate_event"
              : result.outcome === "duplicateSignal"
                ? "duplicate_signal"
                : result.outcome === "processNotFound"
                  ? "process_not_found"
                  : result.outcome === "staleWake"
                    ? "stale_wake"
                    : result.outcome === "revisionConflict"
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
          this.logger.warn(
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
