/**
 * Recovered from the deleted event-sourcing tree for Postgres repositories
 * whose backing fold has since moved to a ClickHouse store built by its own
 * pipeline (`event-sourcing/<name>-processing`) — these classes are no
 * longer plugged into the engine's dispatch, so they no longer implement any
 * engine contract (`ReplaceStore` et al). They keep their own local
 * load/store shape purely so the app-layer read path they still serve
 * continues to compile and behave exactly as before.
 *
 * Deliberately narrower than the old `ProjectionStoreContext`: fields that
 * only the deleted executor produced (readWindow, retentionPolicy,
 * appliedEventIds, deliveryAttempt, bypassReadCache) are dropped because
 * nothing populates them outside that executor.
 */
export interface LegacyProjectionCursor {
  /** When the canonical event log accepted the event. */
  acceptedAt: number;
  /** KSUID tie-breaker for events accepted in the same millisecond. */
  eventId: string;
}

export interface LegacyProjectionStoreContext {
  aggregateId: string;
  tenantId: string;
  key?: string;
}

export interface LegacyStoredProjection<State> {
  state: State;
  cursor: LegacyProjectionCursor;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  version: string;
}

export interface LegacyStateProjectionStore<State> {
  load(
    key: string,
    context: LegacyProjectionStoreContext,
  ): Promise<LegacyStoredProjection<State> | null>;
  store(
    projection: LegacyStoredProjection<State>,
    context: LegacyProjectionStoreContext,
  ): Promise<void>;
}

export interface LegacyAppendStore<Record> {
  /** Appends a single record to the store. */
  append(record: Record, context: LegacyProjectionStoreContext): Promise<void>;
}
