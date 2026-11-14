import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

import type {
  EventLogSearchData,
  eventLogSearchDataSchema,
} from "./ops-event-log-search.events.ts";

export const EVENT_LOG_SEARCH_PROCESS_NAME = "eventLogSearch";

export const eventLogSearchStateSchema = z.object({ requestedAt: z.number().nullable() });
type EventLogSearchState = z.infer<typeof eventLogSearchStateSchema>;

export const EVENT_LOG_SEARCH_INITIAL_STATE: EventLogSearchState = { requestedAt: null };

type EventLogSearchIntents = {
  search: IntentSpec<typeof eventLogSearchDataSchema>;
};

/** Keyed by the request, so a redelivered request asks for its search once. */
export const onEventLogSearchRequested: EventHandler<
  EventLogSearchState,
  EventLogSearchData,
  EventLogSearchIntents
> = (_state, request, ctx) => ({
  state: { requestedAt: ctx.at },
  intents: [ctx.intent("search", `search:${request.requestId}`, request)],
});
