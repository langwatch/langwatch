import type { ProcessRole } from "../../app-layer/config";
import type { Event } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/staticBuilder.types";

/**
 * Context passed to a reactor's handle function.
 */
export interface ReactorContext<FoldState = unknown> {
  tenantId: string;
  aggregateId: string;
  foldState: FoldState;
  /**
   * True when the event was produced by a stream replay rather than
   * live ingestion. The framework `.withOutbox` wrapper short-circuits
   * `match` on replay to avoid re-firing customer-visible side effects
   * after outbox rows have aged out of retention — see ADR-030.
   *
   * `.withReactor` handlers receive the same flag and may inspect it
   * directly if they need replay-specific behavior; most best-effort
   * reactors can ignore it. Optional today so existing handlers and
   * test mocks don't need updating; framework call sites always pass
   * a defined value (live events get `false`).
   */
  isReplay?: boolean;
}

/**
 * Options for configuring a reactor.
 */
export interface ReactorOptions {
  killSwitch?: KillSwitchOptions;
  disabled?: boolean;
  /** Delay in milliseconds before the reactor fires */
  delay?: number;
  /** Deduplication TTL in milliseconds. Only used if makeJobId is provided. */
  ttl?: number;
  /** Deduplication strategy — function that returns a unique job ID for the payload */
  makeJobId?: (payload: { event: Event; foldState: unknown }) => string;
  /** Process roles where this reactor runs. Omit to run everywhere. */
  runIn?: ProcessRole[];
  /** Custom group key function for queue routing. Overrides the domain part of the hierarchical key. */
  groupKeyFn?: (payload: { event: Event; foldState: unknown }) => string;
}

/**
 * Definition of a reactor — a post-fold side-effect handler.
 *
 * A reactor is tied to a specific fold projection and is dispatched
 * after every fold apply + store succeeds. This guarantees correctness:
 * if the fold fails, the reactor never fires.
 *
 * Reactors fire on every fold completion unless a `shouldReact`
 * predicate filters the event out before enqueue.
 * Downstream commands handle their own dedup via makeJobId + delay.
 *
 * See dev/docs/adr/026-reactor-should-react-predicate.md.
 */
export interface ReactorDefinition<E extends Event = Event, FoldState = unknown> {
  /** Unique name for this reactor */
  name: string;
  /**
   * Optional pure predicate evaluated at dispatch time, before any job is
   * enqueued. Return false to skip this reactor entirely for the event.
   *
   * Must be pure and synchronous — no IO, no injected dependencies; it runs
   * on the projection hot path. Guards that need dependencies (DB lookups
   * etc.) belong in handle(). A thrown predicate is caught, logged, and
   * treated as true (fail open — never drops a side effect).
   *
   * The queue payload `{ event, foldState }` is captured at dispatch, so the
   * predicate sees exactly what handle() would receive — do not use this for
   * conditions that should be re-evaluated against fresher state later.
   */
  shouldReact?(event: E, context: ReactorContext<FoldState>): boolean;
  /** Side-effect handler called after fold succeeds */
  handle(event: E, context: ReactorContext<FoldState>): Promise<void>;
  /** Optional configuration */
  options?: ReactorOptions;
}
