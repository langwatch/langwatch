import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import { RecordSeatLimitReachedCommand } from "./seat-limit.commands.ts";
import {
  SEAT_LIMIT_AGGREGATE_TYPE,
  SEAT_LIMIT_PIPELINE_NAME,
  seatLimitReachedEventSchema,
} from "./seat-limit.events.ts";

function seatLimitCommands() {
  return definePipeline({
    name: SEAT_LIMIT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SEAT_LIMIT_AGGREGATE_TYPE }),
  })
    .withEvents([seatLimitReachedEventSchema])
    .withCommand("recordSeatLimitReached", RecordSeatLimitReachedCommand);
}

export type SeatLimitDefinition = ReturnType<ReturnType<typeof seatLimitCommands>["build"]>;

/** organization_seat_limit: organization records its fact; billing reacts from its side (§9). */
export function buildSeatLimitPipeline(): SeatLimitDefinition {
  return seatLimitCommands().build();
}

export const seatLimitEventing = defineEventingModule({
  pipeline: SEAT_LIMIT_PIPELINE_NAME,
  build: ({ app }: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    app.seatLimitPipeline(),
  connect: ({ app, commands }) => app.connectSeatLimit(commands),
});
