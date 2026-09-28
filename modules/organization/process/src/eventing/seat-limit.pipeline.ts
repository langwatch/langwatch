import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { ServerOrganizationApp } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import { RecordSeatLimitReachedCommand } from "./seat-limit.commands.ts";
import {
  SEAT_LIMIT_AGGREGATE_TYPE,
  SEAT_LIMIT_PIPELINE_NAME,
  SEAT_LIMIT_REACHED_EVENT_TYPE,
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

/** organization_seat_limit: the api only records; the worker also tells billing (§9). */
export function buildSeatLimitPipeline(input: {
  billing?: Pick<BillingApi, "notifyResourceLimitReached">;
}): SeatLimitDefinition {
  const billing = input.billing;
  if (!billing) return seatLimitCommands().build();
  return seatLimitCommands()
    .withEventSubscriber("notifyBilling", {
      events: [SEAT_LIMIT_REACHED_EVENT_TYPE],
      handler: async (event) => {
        await billing.notifyResourceLimitReached({
          organizationId: event.data.organizationId,
          limitType: event.data.limitType,
          current: event.data.current,
          max: event.data.max,
        });
      },
    })
    .build();
}

export const seatLimitEventing = defineEventingModule({
  pipeline: SEAT_LIMIT_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<OrganizationRepositories, ServerOrganizationApp>) =>
    app.seatLimitPipeline({ participation }),
  connect: ({ app, commands }) => app.connectSeatLimit(commands),
});
