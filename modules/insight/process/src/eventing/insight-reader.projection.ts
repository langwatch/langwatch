/**
 * One reader's own state on one insight, keyed `insightId:userId`. An insight has one reader
 * today, its owner; the state stays apart from the insight so a later forward can add more.
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSIGHT_EVENT_TYPES,
  INSIGHT_PROJECTION_VERSIONS,
  INSIGHT_READER_EVENT_TYPES,
} from "@langwatch/insight-contract";

import { insightReaderKey } from "../rules/insight-reader-key.rules.ts";
import type { InsightProcessingEvent } from "./insight.events.ts";

export interface InsightReaderState {
  /** Epoch milliseconds, each null until the reader did it. */
  readonly seenAt: number | null;
  readonly archivedAt: number | null;
  readonly keptAt: number | null;
}

const INITIAL_INSIGHT_READER_STATE: InsightReaderState = {
  seenAt: null,
  archivedAt: null,
  keptAt: null,
};

export function applyInsightReaderEvent(
  state: InsightReaderState,
  event: InsightProcessingEvent,
): InsightReaderState {
  switch (event.type) {
    case INSIGHT_EVENT_TYPES.SEEN:
      return { ...state, seenAt: state.seenAt ?? event.occurredAt };
    case INSIGHT_EVENT_TYPES.ARCHIVED:
      return { ...state, archivedAt: event.occurredAt };
    case INSIGHT_EVENT_TYPES.KEPT:
      // Keeping an insight takes it out of Archived as well as out of Stale.
      return { ...state, keptAt: event.occurredAt, archivedAt: null };
    default:
      return state;
  }
}

export function createInsightReaderProjection(deps: {
  store: StateProjectionStore<InsightReaderState>;
}): StateProjectionDefinition<InsightReaderState, InsightProcessingEvent> {
  return {
    name: "insightReader",
    version: INSIGHT_PROJECTION_VERSIONS.READER,
    eventTypes: INSIGHT_READER_EVENT_TYPES,
    init: () => INITIAL_INSIGHT_READER_STATE,
    apply: applyInsightReaderEvent,
    store: deps.store,
    key: (event) =>
      event.type === INSIGHT_EVENT_TYPES.FILED
        ? event.aggregateId
        : insightReaderKey({ insightId: event.data.insightId, userId: event.data.userId }),
  };
}
