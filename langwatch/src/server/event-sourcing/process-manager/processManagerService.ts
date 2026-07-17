import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Tracer,
} from "@opentelemetry/api";

import { ensureJsonSafe } from "./json";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
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
      attributes: {
        "process.name": ref.processName,
        "process.key": ref.processKey,
        "process.source_event_id": envelope.eventId,
        "process.input_kind": "event",
        "tenant.id": envelope.tenantId,
        "project.id": envelope.projectId,
        ...(envelope.userId ? { "user.id": envelope.userId } : {}),
      },
      run: async () => {
        const existing = await this.store.findByRef<State>({ ref });
        const evolution = this.definition.evolve({
          previousState: existing?.state ?? this.definition.initialState,
          input: { kind: "event", event: envelope },
        });

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
          input: { kind: "wake", scheduledFor: wake.wakeAt },
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

    const traceCarrier = this.captureTraceCarrier();
    const messages: NewOutboxMessage[] = evolution.intents.map((intent) => {
      ensureJsonSafe(intent.payload);
      return {
        messageKey: intent.messageKey,
        intentType: intent.intentType,
        payload: intent.payload,
        traceCarrier,
        ...(params.userId ? { userId: params.userId } : {}),
      };
    });

    return await this.store.commit({
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

  private async inEvolveSpan<T>(params: {
    attributes: Attributes;
    run: () => Promise<T>;
  }): Promise<T> {
    return await this.tracer.startActiveSpan(
      `process ${this.definition.name} evolve`,
      { kind: SpanKind.INTERNAL, attributes: params.attributes },
      async (span) => {
        try {
          return await params.run();
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
