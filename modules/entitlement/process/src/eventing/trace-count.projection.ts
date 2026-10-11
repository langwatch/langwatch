import type {
  FoldProjectionStore,
  PeerEvent,
  PeerFoldProjectionDeclaration,
} from "@langwatch/eventing";
import {
  TRACE_FIRST_SEEN_EVENT_TYPE,
  TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE,
  traceFirstSeenEventDataSchema,
  tracesCountedBeforeCutEventDataSchema,
} from "@langwatch/trace-contract";

import {
  TRACE_COUNT_PROJECTION_VERSION,
  type TraceCountState,
} from "../repositories/trace-count.repository.ts";
import { countFirstSighting, setSeededBase } from "../rules/trace-count.rules.ts";
import { TraceCountStoreService } from "../services/trace-count-store.service.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";

/** Frozen once landed: the peer lane is `entitlement.usageTraceCount`. */
export const TRACE_COUNT_PROJECTION_NAME = "usageTraceCount";

/** Trace's two facts the count folds, each parsed by trace-contract's own schema. */
export const TRACE_COUNT_EVENTS = [
  { type: TRACE_FIRST_SEEN_EVENT_TYPE, data: traceFirstSeenEventDataSchema },
  { type: TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE, data: tracesCountedBeforeCutEventDataSchema },
] as const;

type TraceCountEvent = PeerEvent<typeof TRACE_COUNT_EVENTS>;

/** The project and month a fact counts in: a sighting's own month, a seed's named one. */
function monthOf(event: TraceCountEvent): string {
  return event.type === TRACE_FIRST_SEEN_EVENT_TYPE
    ? UsageCountingService.monthOf(event.data.firstSeenAt)
    : event.data.month;
}

/** Folds one fact; order-insensitive, so a replay and the live lane reach the same count. */
function foldTraceCount(state: TraceCountState, event: TraceCountEvent): TraceCountState {
  const named = {
    ...state,
    projectId: event.data.projectId,
    month: monthOf(event),
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
  };
  return event.type === TRACE_FIRST_SEEN_EVENT_TYPE
    ? countFirstSighting({ state: named, firstSeenAt: event.data.firstSeenAt })
    : setSeededBase({ state: named, traces: event.data.traces, cutAt: event.data.cutAt });
}

/** Entitlement's count of a project's month, a peer fold over trace's facts on its own store. */
export function traceCountPeerFold(
  store: FoldProjectionStore<TraceCountState>,
): PeerFoldProjectionDeclaration<TraceCountState, typeof TRACE_COUNT_EVENTS> {
  return {
    events: TRACE_COUNT_EVENTS,
    fold: {
      name: TRACE_COUNT_PROJECTION_NAME,
      version: TRACE_COUNT_PROJECTION_VERSION,
      eventTypes: TRACE_COUNT_EVENTS.map(({ type }) => type),
      init: () => ({
        projectId: "",
        month: "",
        seeded: null,
        liveByHour: {},
        LastEventOccurredAt: 0,
      }),
      apply: foldTraceCount,
      key: (event) =>
        TraceCountStoreService.keyOf({ projectId: event.data.projectId, month: monthOf(event) }),
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
      options: { refoldOnOutOfOrder: false, trustAbsentMiss: true },
    },
  };
}
