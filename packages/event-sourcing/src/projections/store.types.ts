/**
 * What a store promises, and nothing about what implements it (ADR-102). Three
 * contracts, and the axis is what happens when two records share a key
 * (ADR-099): `append` keeps both, `replace` keeps the newest, `merge` combines
 * them. `merge` is separate because combining is not idempotent, so a mount
 * onto it has to say how it avoids double counting.
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
 * A stored fold state and the shape it was written under.
 *
 * There is no redelivery guard here, and that is the design: a fold is a
 * function of the SET of events, so re-applying a delivery changes nothing
 * (ADR-098 §5). A per-row sequence would be a guard against a hazard the fold
 * is required not to have.
 *
 * A row whose `version` the current build cannot decode is refused, never
 * treated as absent.
 */
export interface StoredState<State> {
  readonly state: State;
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
 * Two properties are part of this contract, not implementation detail. The
 * write is **durable-first** — the call must not return until the state is
 * durable. And a read following a completed write for the same key must
 * **observe that write**: without it a fold reads `absent` for a key it just
 * wrote, restarts from `init()` and overwrites what it committed, silently, on
 * exactly the aggregates that are busiest.
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
