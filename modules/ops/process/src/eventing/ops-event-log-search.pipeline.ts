import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { OpsModule } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import {
  RecordEventLogSearchCompletedCommand,
  RequestEventLogSearchCommand,
} from "./ops-event-log-search.commands.ts";
import {
  EVENT_LOG_SEARCH_AGGREGATE_TYPE,
  EVENT_LOG_SEARCH_PIPELINE_NAME,
  type EventLogSearchCompletedEvent,
  type EventLogSearchData,
  type EventLogSearchRequestedEvent,
  eventLogSearchCompletedEventSchema,
  eventLogSearchDataSchema,
  eventLogSearchRequestedEventSchema,
} from "./ops-event-log-search.events.ts";
import {
  EVENT_LOG_SEARCH_INITIAL_STATE,
  EVENT_LOG_SEARCH_PROCESS_NAME,
  eventLogSearchStateSchema,
  onEventLogSearchRequested,
} from "./ops-event-log-search.process.ts";

type EventLogSearchDefinition = StaticPipelineDefinition<
  EventLogSearchRequestedEvent | EventLogSearchCompletedEvent,
  Record<string, Projection>,
  | { name: "requestEventLogSearch"; payload: EventLogSearchData & CommandEnvelope }
  | { name: "recordEventLogSearchCompleted"; payload: EventLogSearchData & CommandEnvelope }
>;

/**
 * An operator's event-log search reads every tenant, so it runs in the worker on the system
 * identity, never in the api (ADR-202 Decided 14): the api stores the request and sends the
 * command; the completion is the read hint the screen refetches on.
 */
export function buildEventLogSearch({
  app,
}: EventingSetup<unknown, Pick<OpsModule, "runAggregateSearch">>): EventLogSearchDefinition {
  return definePipeline({
    name: EVENT_LOG_SEARCH_PIPELINE_NAME,
    aggregate: defineAggregate({ type: EVENT_LOG_SEARCH_AGGREGATE_TYPE }),
  })
    .withEvents([eventLogSearchRequestedEventSchema, eventLogSearchCompletedEventSchema])
    .withCommand("requestEventLogSearch", RequestEventLogSearchCommand)
    .withCommand("recordEventLogSearchCompleted", RecordEventLogSearchCompletedCommand)
    .withProcessManager(EVENT_LOG_SEARCH_PROCESS_NAME, (pm) =>
      pm
        .state(eventLogSearchStateSchema, EVENT_LOG_SEARCH_INITIAL_STATE)
        .intent("search", eventLogSearchDataSchema, (request, context) =>
          app.runAggregateSearch({ requestId: request.requestId, tenantId: context.tenantId }),
        )
        .on(eventLogSearchRequestedEventSchema, onEventLogSearchRequested),
    )
    .build();
}

export const eventLogSearchEventing = defineEventingModule({
  pipeline: EVENT_LOG_SEARCH_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildEventLogSearch(setup),
  connect: ({ app, commands }) => app.connectEventLogSearch(commands),
});
