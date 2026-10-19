import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { AuthzModule } from "../app/authz.app.ts";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import { RecordAggregateReadCommand } from "./authz-aggregate-read.commands.ts";
import {
  AUTHZ_AGGREGATE_READ_AGGREGATE_TYPE,
  AUTHZ_AGGREGATE_READ_PIPELINE_NAME,
  authzAggregateReadEventSchema,
} from "./authz-aggregate-read.events.ts";

function aggregateReadCommands() {
  return definePipeline({
    name: AUTHZ_AGGREGATE_READ_PIPELINE_NAME,
    aggregate: defineAggregate({ type: AUTHZ_AGGREGATE_READ_AGGREGATE_TYPE }),
  })
    .withEvents([authzAggregateReadEventSchema])
    .withCommand("recordAggregateRead", RecordAggregateReadCommand);
}

export type AuthzAggregateReadDefinition = ReturnType<
  ReturnType<typeof aggregateReadCommands>["build"]
>;

/** authz_aggregate_read: authz records the fact, governance writes the audit row (§9). */
export function buildAuthzAggregateReadPipeline(): AuthzAggregateReadDefinition {
  return aggregateReadCommands().build();
}

export const authzAggregateReadEventing = defineEventingModule({
  pipeline: AUTHZ_AGGREGATE_READ_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuthzRepositories, AuthzModule>) => app.aggregateReadPipeline(),
  connect: ({ app, commands }) => app.connectAggregateRead(commands),
});
