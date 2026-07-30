import {
  createFoldExecutor,
  type FoldExecutorDeps,
  type FoldOutcome,
  type Metrics,
  type ReplaceStore,
} from "@langwatch/event-sourcing";
import {
  foldLangyConversationState,
  initLangyConversationState,
  type LangyConversationStateEvent,
  type LangyConversationStateFoldState,
} from "@langwatch/langy";

/**
 * The `langyConversationState` fold — the conversation spine, keyed by
 * `conversationId`. The accumulator is `@langwatch/langy`'s
 * `foldLangyConversationState`, shared with the browser fold and applied
 * directly. `LastEventId`/`AcceptedAt` are this rig's own cursor, appended
 * after each delegate call so a reader can tell whether the projection has
 * caught up to a given event.
 */

/**
 * One dispatched event: the shared fold's own discriminated union, plus the
 * two envelope fields it does not carry — the event's id and the platform
 * accept time (ADR-099 `acceptedAt` — frozen, ours, never the customer-
 * stamped `occurredAt`). Intersecting (rather than declaring `type`/`data`
 * as two independent fields) keeps the discriminant correlation intact, so
 * `foldLangyConversationState` accepts this directly with no cast.
 */
export type LangyConversationEnvelopeEvent = LangyConversationStateEvent & {
  readonly id: string;
  readonly createdAt: number;
};

export interface LangyConversationSpineState extends LangyConversationStateFoldState {
  readonly LastEventId: string;
  readonly AcceptedAt: number;
}

export function initLangyConversationSpineState(): LangyConversationSpineState {
  return { ...initLangyConversationState(), LastEventId: "", AcceptedAt: 0 };
}

export function applyLangyConversationSpineEvent(
  state: LangyConversationSpineState,
  event: LangyConversationEnvelopeEvent,
): LangyConversationSpineState {
  const next = foldLangyConversationState(state, event);
  return { ...next, LastEventId: event.id, AcceptedAt: event.createdAt };
}

/**
 * Pinned rather than derived (ADR-105 §4): the row shape this fold reads and
 * writes is the existing `LangyConversationProjection` table
 * (`store/conversationState.store.ts`), a cutover onto an established shape
 * rather than a fresh one a schema hash could safely derive from day one.
 */
export const LANGY_CONVERSATION_SPINE_STATE_VERSION = "2026-07-30";

const PROJECTION_NAME = "langyConversationState";

/**
 * `MessageCount` is a running total the shared fold accumulates, so a genuine
 * retry double-counts it. Every other field converges to the same row whether
 * an event is applied once or twice.
 */
export function createLangyConversationStateFoldExecutor(deps: {
  readonly store: ReplaceStore<LangyConversationSpineState>;
  readonly metrics?: Metrics;
}): {
  apply(delivery: {
    key: string;
    tenantId: string;
    events: readonly LangyConversationEnvelopeEvent[];
    retentionDays?: number;
  }): Promise<FoldOutcome>;
} {
  const foldDeps: FoldExecutorDeps<LangyConversationSpineState, LangyConversationEnvelopeEvent> = {
    store: deps.store,
    init: initLangyConversationSpineState,
    apply: applyLangyConversationSpineEvent,
    stateVersion: LANGY_CONVERSATION_SPINE_STATE_VERSION,
    projectionName: PROJECTION_NAME,
    metrics: deps.metrics,
  };
  const executor = createFoldExecutor(foldDeps);
  return {
    apply: (delivery) =>
      executor.apply({
        key: delivery.key,
        tenantId: delivery.tenantId,
        events: delivery.events,
        retentionDays: delivery.retentionDays,
      }),
  };
}
