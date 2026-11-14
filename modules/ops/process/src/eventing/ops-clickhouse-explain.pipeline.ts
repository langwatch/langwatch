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
import { RequestClickHouseExplainCommand } from "./ops-clickhouse-explain.commands.ts";
import {
  CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE,
  CLICKHOUSE_EXPLAIN_PIPELINE_NAME,
  type ClickHouseExplainRequested,
  type ClickHouseExplainRequestedEvent,
  clickhouseExplainRequestedDataSchema,
  clickhouseExplainRequestedEventSchema,
} from "./ops-clickhouse-explain.events.ts";
import {
  CLICKHOUSE_EXPLAIN_INITIAL_STATE,
  CLICKHOUSE_EXPLAIN_PROCESS_NAME,
  clickhouseExplainStateSchema,
  onClickHouseExplainRequested,
} from "./ops-clickhouse-explain.process.ts";

type ClickHouseExplainDefinition = StaticPipelineDefinition<
  ClickHouseExplainRequestedEvent,
  Record<string, Projection>,
  { name: "requestClickHouseExplain"; payload: ClickHouseExplainRequested & CommandEnvelope }
>;

/**
 * An operator EXPLAIN reads across tenants, so it runs in the worker on the ops identity, never
 * in the api (ADR-202 Decided 14): the api stores the request and sends the command.
 */
export function buildClickHouseExplain({
  app,
}: EventingSetup<unknown, Pick<OpsModule, "runClickHouseExplain">>): ClickHouseExplainDefinition {
  return definePipeline({
    name: CLICKHOUSE_EXPLAIN_PIPELINE_NAME,
    aggregate: defineAggregate({ type: CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE }),
  })
    .withEvents([clickhouseExplainRequestedEventSchema])
    .withCommand("requestClickHouseExplain", RequestClickHouseExplainCommand)
    .withProcessManager(CLICKHOUSE_EXPLAIN_PROCESS_NAME, (pm) =>
      pm
        .state(clickhouseExplainStateSchema, CLICKHOUSE_EXPLAIN_INITIAL_STATE)
        .intent("explain", clickhouseExplainRequestedDataSchema, (request) =>
          app.runClickHouseExplain(request),
        )
        .on(clickhouseExplainRequestedEventSchema, onClickHouseExplainRequested),
    )
    .build();
}

export const clickhouseExplainEventing = defineEventingModule({
  pipeline: CLICKHOUSE_EXPLAIN_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildClickHouseExplain(setup),
  connect: ({ app, commands }) => app.connectClickHouseExplain(commands),
});
