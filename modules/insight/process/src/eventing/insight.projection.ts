/**
 * The record of one insight and whose it is, folded onto its row. The owner's acts ride the
 * same stream and are folded by `insight-reader.projection.ts`, never here.
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

import type { InsightProcessingEvent } from "./insight.events.ts";

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
  filedAt: 0,
  renewedAt: null,
};

export function applyInsightEvent(
  state: InsightState,
  event: InsightProcessingEvent,
): InsightState {
  if (event.type !== INSIGHT_EVENT_TYPES.FILED) return state;
  const { insightId: _insightId, ownerUserId, ...filed } = event.data;
  return {
    ...state,
    ...filed,
    // An event stored before owners existed names none: whoever filed it owns it.
    ownerUserId: ownerUserId ?? filed.filedByUserId,
    filedAt: event.occurredAt,
  };
}

export function createInsightProjection(deps: {
  store: StateProjectionStore<InsightState>;
}): StateProjectionDefinition<InsightState, InsightProcessingEvent> {
  return {
    name: "insight",
    version: INSIGHT_PROJECTION_VERSIONS.INSIGHT,
    eventTypes: [INSIGHT_EVENT_TYPES.FILED],
    init: () => INITIAL_INSIGHT_STATE,
    apply: applyInsightEvent,
    store: deps.store,
    key: (event) => event.aggregateId,
  };
}
