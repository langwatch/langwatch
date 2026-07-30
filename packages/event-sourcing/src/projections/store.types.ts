/**
 * What a store promises, and nothing about what implements it (ADR-102).
 *
 * The core never names a database. A fold's state lands in an analytical column
 * store for some projections and in a relational row for others, and neither is
 * a special case — they are two implementations of one contract. Keeping the
 * technology out of these types is what makes that true rather than aspirational.
 *
 * There are three contracts, and the axis is what the store does when two
 * records share a key (ADR-099):
 *
 * - `append` — both survive.
 * - `replace` — the newest wins.
 * - `merge` — the store combines them.
 *
 * The third is the dangerous one: combining is not idempotent, so a redelivered
 * write changes the answer. It is declared separately rather than folded into
 * `append` precisely so that a projection mounting onto it has to say how it
 * avoids double counting.
 */

import type { Metrics } from "../ports/metrics";

/** Tenant identity travels with every store call; nothing is global. */
export type TenantId = string;

/**
 * Per-call context. Deliberately small: anything a specific store needs beyond
 * this belongs on the record, not in a context every store has to accept.
 */
export interface StoreContext {
  readonly tenantId: TenantId;
  /**
   * How long the written data may be kept, resolved by the application. The
   * core does not interpret it — it carries it, so a store that stamps
   * retention has it, and one that does not can ignore it.
   */
  readonly retentionDays?: number;
}

/**
 * A batch spans many aggregates of one tenant, so it carries no aggregate id.
 * Anything a store needs per record must be on the record.
 */
export interface BatchContext {
  readonly tenantId: TenantId;
  readonly retentionDays?: number;
}

/**
 * A stored fold state, with the bookkeeping the executor owns.
 *
 * `deliverySeq` is the redelivery guard (ADR-098): the sequence of the last
 * delivery applied to this row. A redelivered job carries the same sequence and
 * is skipped. It is not an event-time watermark — a watermark cannot tell a
 * retry from a late arrival, and late arrivals are normal.
 *
 * `version` is the shape the state was written under. A row whose version the
 * current build cannot decode is refused, never treated as absent.
 */
export interface StoredState<State> {
  readonly state: State;
  readonly deliverySeq: number;
  readonly version: string;
}

/**
 * The outcome of reading a fold's state back.
 *
 * Three cases, and the third is the one that matters. Collapsing `undecodable`
 * into `absent` would make the first deploy that changes a fold's shape read
 * every row as genesis and overwrite live state with a fresh accumulator, so
 * the type refuses to let a caller ignore the distinction.
 */
export type StateRead<State> =
  | { readonly kind: "found"; readonly stored: StoredState<State> }
  | { readonly kind: "absent" }
  | {
      readonly kind: "undecodable";
      readonly storedVersion: string | undefined;
      readonly cause?: unknown;
    };

/**
 * A store for a fold: read prior state, write it back.
 *
 * The write is durable-first by contract — this call must not return until the
 * state is durable. A cache in front of it is the implementation's business,
 * and its failure semantics are specified where it lives (ADR-098): a failed
 * cache write deletes the key rather than leaving a stale one, because a stale
 * entry means the next read serves superseded state and the fold applies the
 * next event on top of it.
 */
/**
 * **Read-your-writes is part of this contract, not an implementation detail.**
 *
 * A fold that reads `absent` for a key it has already written restarts from
 * `init()` and overwrites the state it just committed. Durability alone does not
 * prevent that: on a replicated table a write can be durable and not yet visible
 * on the replica that serves the next read, and this deployment routes
 * connections through a load balancer that can send each one to a different
 * node — the migration bootstrap already notes that hazard for replicated
 * databases.
 *
 * So an implementation must guarantee that a read following a completed write
 * for the same key observes that write. How it does so is its own business —
 * sequential-consistency settings on the read, pinning a key's reads to the node
 * that took its write, or serving from a cache tier that is authoritative for
 * recent state. What it may not do is leave the guarantee to chance, because the
 * failure is silent state loss on exactly the aggregates that are busiest.
 */
export interface ReplaceStore<State> {
  readonly kind: "replace";
  read(key: string, context: StoreContext): Promise<StateRead<State>>;
  write(
    key: string,
    stored: StoredState<State>,
    context: StoreContext,
  ): Promise<void>;
}

/**
 * A store for a map: records are written, never read back.
 *
 * `writeBatch` is the primary path, not an optimisation. One write per event is
 * what creates a part per event in a column store, and that is the shape that
 * has already caused an incident. A store that cannot batch says so by not
 * implementing this interface.
 */
export interface AppendStore<Record> {
  readonly kind: "append";
  writeBatch(records: readonly Record[], context: BatchContext): Promise<void>;
}

/**
 * A store whose engine combines records sharing a key.
 *
 * The only contract of the three that is not idempotent under redelivery, so it
 * carries an explicit statement of how that is handled. `idempotency` is
 * required rather than optional: a mount that cannot answer the question does
 * not compile, which is the whole reason this is a separate kind.
 */
export interface MergeStore<Record> {
  readonly kind: "merge";
  /**
   * How a redelivered write avoids double counting. `"upstream-exactly-once"`
   * asserts the caller guarantees single delivery; `"whole-bucket-replace"`
   * asserts each write carries the complete value for its key rather than a
   * delta.
   */
  readonly idempotency: "upstream-exactly-once" | "whole-bucket-replace";
  writeBatch(records: readonly Record[], context: BatchContext): Promise<void>;
}

export type Store<T> = ReplaceStore<T> | AppendStore<T> | MergeStore<T>;

/** Ports a store implementation may be given at construction. */
export interface StoreDeps {
  readonly metrics: Metrics;
}
