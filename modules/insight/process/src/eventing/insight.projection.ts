/**
 * The record of one insight and whose it is, folded onto its row: as it was filed, then as
 * each later run renewed it. The owner's acts ride the same stream and are folded by
 * `insight-reader.projection.ts`, never here.
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_EVENT_TYPES,
  INSIGHT_PROJECTION_VERSIONS,
  type InsightBoard,
  type InsightFiledVia,
  type InsightReplay,
  type InsightSource,
  type InsightTone,
} from "@langwatch/insight-contract";

import type {
  InsightFiledEvent,
  InsightProcessingEvent,
  InsightRenewedEvent,
} from "./insight.events.ts";

export interface InsightState {
  readonly title: string;
  readonly body: string;
  readonly tone: InsightTone;
  readonly topic: string | null;
  readonly validDays: number;
  readonly lwql: string | null;
  readonly replay: InsightReplay | null;
  readonly source: InsightSource | null;
  readonly board: InsightBoard | null;
  readonly filedVia: InsightFiledVia;
  /** The one person who reads the insight; null only when the event names nobody at all. */
  readonly ownerUserId: string | null;
  readonly filedByUserId: string | null;
  /** The key a daily run matches a repeated finding by; null when no run filed it. */
  readonly findingKey: string | null;
  /** Epoch milliseconds. */
  readonly filedAt: number;
  readonly renewedAt: number | null;
}

const INITIAL_INSIGHT_STATE: InsightState = {
  title: "",
  body: "",
  tone: "watch",
  topic: null,
  validDays: 1,
  lwql: null,
  replay: null,
  source: null,
  board: null,
  filedVia: "chat",
  ownerUserId: null,
  filedByUserId: null,
  findingKey: null,
  filedAt: 0,
  renewedAt: null,
};

function applyFiled(state: InsightState, event: InsightFiledEvent): InsightState {
  const { insightId: _insightId, ownerUserId, ...filed } = event.data;
  return {
    ...state,
    ...filed,
    // An event stored before owners existed names none: whoever filed it owns it.
    ownerUserId: ownerUserId ?? filed.filedByUserId,
    filedAt: event.occurredAt,
  };
}

function applyRenewed(state: InsightState, event: InsightRenewedEvent): InsightState {
  // A renewal older than the one the row holds is a late repeat of an earlier run's.
  if (state.renewedAt !== null && event.occurredAt < state.renewedAt) return state;
  const { insightId: _insightId, tone, source, ...renewed } = event.data;
  return {
    ...state,
    ...renewed,
    tone: tone ?? state.tone,
    source: source ?? state.source,
    renewedAt: event.occurredAt,
  };
}

export function applyInsightEvent(
  state: InsightState,
  event: InsightProcessingEvent,
): InsightState {
  switch (event.type) {
    case INSIGHT_EVENT_TYPES.FILED:
      return applyFiled(state, event);
    case INSIGHT_EVENT_TYPES.RENEWED:
      return applyRenewed(state, event);
    default:
      return state;
  }
}

export function createInsightProjection(deps: {
  store: StateProjectionStore<InsightState>;
}): StateProjectionDefinition<InsightState, InsightProcessingEvent> {
  return {
    name: "insight",
    version: INSIGHT_PROJECTION_VERSIONS.INSIGHT,
    eventTypes: [INSIGHT_EVENT_TYPES.FILED, INSIGHT_EVENT_TYPES.RENEWED],
    init: () => INITIAL_INSIGHT_STATE,
    apply: applyInsightEvent,
    store: deps.store,
    key: (event) => event.aggregateId,
  };
}
