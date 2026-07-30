import {
  createFoldExecutor,
  type FoldExecutorDeps,
  type FoldOutcome,
  type Metrics,
  type ReplaceStore,
} from "@langwatch/event-sourcing";
import {
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  makeConversationTurnKey,
  type LangyConversationTurnEvent,
  type LangyConversationTurnFoldState,
} from "@langwatch/langy";

/**
 * The `langyConversationTurn` fold — the per-turn render document, keyed by
 * `${conversationId}:${turnId}` (ADR-098 §2, ADR-105 §6). A second,
 * independent fold over the same event stream as `conversationState.fold.ts`
 * — see `aggregate.ts`'s module docblock for why one `defineAggregate` can
 * own more than one fold projection.
 *
 * The accumulator is `@langwatch/langy`'s `foldLangyConversationTurn`,
 * shared with the browser fold — imported and applied directly.
 */

export type LangyConversationTurnEnvelopeEvent = LangyConversationTurnEvent & {
  readonly id: string;
  readonly createdAt: number;
};

export interface LangyConversationTurnSpineState extends LangyConversationTurnFoldState {
  readonly LastEventId: string;
  readonly AcceptedAt: number;
}

export function initLangyConversationTurnSpineState(): LangyConversationTurnSpineState {
  return { ...initLangyConversationTurnState(), LastEventId: "", AcceptedAt: 0 };
}

export function applyLangyConversationTurnEvent(
  state: LangyConversationTurnSpineState,
  event: LangyConversationTurnEnvelopeEvent,
): LangyConversationTurnSpineState {
  const next = foldLangyConversationTurn(state, event);
  return { ...next, LastEventId: event.id, AcceptedAt: event.createdAt };
}

/**
 * The turn fold's key. `makeConversationTurnKey` refuses an empty
 * `conversationId`/`turnId` (`@langwatch/langy`) rather than collapsing a
 * missing identity onto a shared document, so this re-export is the only
 * place a caller in this pipeline should construct the key.
 */
export { makeConversationTurnKey };

/** Pinned — see `conversationState.fold.ts`'s identical note; same table shape. */
export const LANGY_CONVERSATION_TURN_STATE_VERSION = "2026-07-30";

const PROJECTION_NAME = "langyConversationTurn";

/**
 * Every field converges under exact re-application: tool calls upsert by id,
 * `Plan` is a snapshot replace, and the terminal-status guard protects
 * `Status`/`Error`/`EndedAt`/`AnswerParts` together. No running totals.
 */
export function createLangyConversationTurnFoldExecutor(deps: {
  readonly store: ReplaceStore<LangyConversationTurnSpineState>;
  readonly metrics?: Metrics;
}): {
  apply(delivery: {
    key: string;
    tenantId: string;
    events: readonly LangyConversationTurnEnvelopeEvent[];
    retentionDays?: number;
  }): Promise<FoldOutcome>;
} {
  const foldDeps: FoldExecutorDeps<
    LangyConversationTurnSpineState,
    LangyConversationTurnEnvelopeEvent
  > = {
    store: deps.store,
    init: initLangyConversationTurnSpineState,
    apply: applyLangyConversationTurnEvent,
    stateVersion: LANGY_CONVERSATION_TURN_STATE_VERSION,
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
