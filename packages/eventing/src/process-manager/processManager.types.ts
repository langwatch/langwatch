import type { JsonValue } from "./json";

/**
 * Generic process-manager domain contracts for ADR-049's Langy pilot.
 *
 * A process is identified by (processName, projectId, processKey) — the
 * ADR-049 uniqueness contract. Its definition is a single pure function:
 * evolve(previousState, input) -> { state, nextWakeAt, intents }. All
 * persistence, idempotency, revision, and dispatch concerns live behind the
 * ProcessStore port; the definition never touches infrastructure and never
 * reads a query projection.
 */
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

/**
 * A synchronous command sent directly to one existing process instance.
 *
 * `signalId` is the caller-stable idempotency identity within one process
 * name and project. Include the domain/process identity when one caller can
 * signal several process keys. A response may be lost after the store
 * commits, so a retry with the same identity must converge on the
 * already-committed process state instead of evolving it a second time.
 * Signals do not create process instances by default. A process definition
 * that models an admission gate or another signal-owned lifecycle may opt in
 * explicitly at the runtime call site; its initial signal then competes under
 * the same revision-0 compare-and-swap as every other transition.
 */
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

/**
 * What a process consumes: a committed event, or its own due wake-up.
 *
 * BOTH variants carry `now`, the instant the input is actually being handled,
 * alongside the instant it refers to (`scheduledFor` for a wake, the
 * envelope's `occurredAt` for an event). They diverge whenever the fleet was
 * down or the subscriber backed up. A definition that schedules purely from
 * the referenced instant either replays every missed slot one commit at a
 * time (wakes) or writes a `nextWakeAt` that is already in the past (events).
 * Handing `now` in as data keeps `evolve` pure while letting it clamp.
 */
export type ProcessInput =
  | { kind: "event"; event: ProcessEventEnvelope; now: number }
  | { kind: "wake"; scheduledFor: number; now: number };

/**
 * An effect the process intends to cause. `messageKey` is the deterministic
 * idempotency identity within (processName, projectId) — e.g.
 * `dispatch:<turnId>:<generation>`, `fail:<turnId>`, `title:<turnId>`.
 * Payloads must be JSON-safe. Application adapters own the stricter domain
 * schema and decide which data may cross this boundary.
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
  evolveSignal?(params: {
    previousState: State;
    signal: ProcessSignalEnvelope;
    now: number;
    ref: ProcessRef;
  }): Evolution<State>;
}
