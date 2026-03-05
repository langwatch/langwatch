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
}

/**
 * Definition of a reactor — a post-fold side-effect handler.
 *
 * A reactor is tied to a specific fold projection and is dispatched
 * after every fold apply + store succeeds. This guarantees correctness:
 * if the fold fails, the reactor never fires.
 *
 * Reactors fire on every fold completion (no eventTypes filter).
 * Downstream commands handle their own dedup via makeJobId + delay.
 */
export interface ReactorDefinition<E extends Event = Event, FoldState = unknown> {
  /** Unique name for this reactor */
  name: string;
  /** Side-effect handler called after fold succeeds */
  handle(event: E, context: ReactorContext<FoldState>): Promise<void>;
  /** Optional configuration */
  options?: ReactorOptions;
}
