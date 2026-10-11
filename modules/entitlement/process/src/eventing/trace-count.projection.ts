import type {
  FoldProjectionStore,
  PeerEvent,
  PeerFoldProjectionDeclaration,
} from "@langwatch/eventing";
import {
  TRACE_FIRST_SEEN_EVENT_TYPE,
  MONTH_TRACES_COUNTED_EVENT_TYPE,
  traceFirstSeenEventDataSchema,
  monthTracesCountedEventDataSchema,
} from "@langwatch/trace-contract";

import {
  TRACE_COUNT_PROJECTION_VERSION,
  type TraceCountState,
} from "../repositories/trace-count.repository.ts";
import { addNewTrace, setMonthCount } from "../rules/trace-count.rules.ts";
import { TraceCountStoreService } from "../services/trace-count-store.service.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";

/** Frozen once landed: the peer lane is `entitlement.usageTraceCount`. */
export const TRACE_COUNT_PROJECTION_NAME = "usageTraceCount";

/** Trace's two events the count folds, each parsed by trace-contract's own schema. */
export const TRACE_COUNT_EVENTS = [
  { type: TRACE_FIRST_SEEN_EVENT_TYPE, data: traceFirstSeenEventDataSchema },
  { type: MONTH_TRACES_COUNTED_EVENT_TYPE, data: monthTracesCountedEventDataSchema },
] as const;

type TraceCountEvent = PeerEvent<typeof TRACE_COUNT_EVENTS>;

/** The month an event counts in: a new trace's own month, the upgrade count's named one. */
function monthOf(event: TraceCountEvent): string {
  return event.type === TRACE_FIRST_SEEN_EVENT_TYPE
    ? UsageCountingService.monthOf(event.data.firstSeenAt)
    : event.data.month;
}

/** Folds one event; order-insensitive, so a replay and the live lane reach the same count. */
function foldTraceCount(state: TraceCountState, event: TraceCountEvent): TraceCountState {
  const named = {
    ...state,
    projectId: event.data.projectId,
    month: monthOf(event),
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
  };
  return event.type === TRACE_FIRST_SEEN_EVENT_TYPE
    ? addNewTrace(named)
    : setMonthCount({ state: named, traces: event.data.traces });
}

/** Entitlement's count of a project's month, a peer fold over trace's events on its own store. */
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
        counted: 0,
        live: 0,
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
