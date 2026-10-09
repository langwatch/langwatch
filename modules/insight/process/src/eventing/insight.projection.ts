/**
 * The shared record of one insight, folded onto its row. Reader acts ride the same stream
 * and are folded by `insight-reader.projection.ts`, never here.
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_EVENT_TYPES,
  INSIGHT_PROJECTION_VERSIONS,
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
  readonly source: InsightSource | null;
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
  source: null,
  filedByUserId: null,
  filedAt: 0,
  renewedAt: null,
};

export function applyInsightEvent(
  state: InsightState,
  event: InsightProcessingEvent,
): InsightState {
  if (event.type !== INSIGHT_EVENT_TYPES.FILED) return state;
  const { insightId: _insightId, ...filed } = event.data;
  return { ...state, ...filed, filedAt: event.occurredAt };
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
