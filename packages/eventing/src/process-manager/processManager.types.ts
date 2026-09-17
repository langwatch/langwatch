import type { JsonValue } from "./json.ts";

/** Process-manager domain contracts; identified by (processName, projectId, processKey). */
export interface ProcessRef {
  processName: string;
  projectId: string;
  processKey: string;
}

/**
 * The committed event as carried by the queue envelope (ADR-049 §1/§3).
 * `payload` is whatever the source event schema defines, already JSON-safe.
 */
export interface ProcessEventEnvelope {
  eventId: string;
  eventType: string;
  /** Epoch milliseconds. */
  occurredAt: number;
  tenantId: string;
  projectId: string;
  /** The aggregate identity this process is keyed by, e.g. a conversationId. */
  processKey: string;
  userId?: string;
  payload: JsonValue;
}

/** Synchronous command to a process instance; signals don't create instances by default. */
export interface ProcessSignalEnvelope {
  signalId: string;
  signalType: string;
  /** Epoch milliseconds at which the application accepted the signal. */
  occurredAt: number;
  projectId: string;
  processKey: string;
  userId?: string;
  payload: JsonValue;
}

/** Process input: committed event or due wake-up; both carry handling time (now). */
export type ProcessInput =
  | { kind: "event"; event: ProcessEventEnvelope; now: number }
  | { kind: "wake"; scheduledFor: number; now: number };

/**
 * An effect the process intends to cause. `messageKey` is the deterministic
 * idempotency identity within (processName, projectId), e.g.
 * `dispatch:<turnId>:<generation>`. Payloads must be JSON-safe.
 */
export interface ProcessIntent {
  messageKey: string;
  intentType: string;
  payload: JsonValue;
}

/** The result of one pure evolution step. `nextWakeAt` is authoritative:
 * `null` clears any scheduled wake-up; a number (epoch ms) replaces it. */
export interface Evolution<State> {
  state: State;
  nextWakeAt: number | null;
  intents: ProcessIntent[];
}

export interface ProcessDefinition<State> {
  name: string;
  /** State an unseen process key starts from. */
  initialState: State;
  /**
   * Whether an evolution that keeps `initialState` and arms no wake may skip
   * the instance row, the inbox row and the transaction, committing only its
   * intents. See `ProcessManagerConfig.transient`.
   */
  transient?: boolean;
  /** Pure: no I/O, no clocks, no projection reads. */
  evolve(params: { previousState: State; input: ProcessInput; ref: ProcessRef }): Evolution<State>;
  /**
   * Optional pure external-signal evolution. Persistence and retry semantics
   * remain in ProcessManagerService; this function only decides the next
   * state, wake and durable intents.
   */
  evolveSignal?: (params: {
    previousState: State;
    signal: ProcessSignalEnvelope;
    now: number;
    ref: ProcessRef;
  }) => Evolution<State>;
}
