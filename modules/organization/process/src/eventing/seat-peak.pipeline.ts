import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  ORGANIZATION_CREATED_EVENT_TYPE,
  organizationCreatedEventDataSchema,
} from "@langwatch/organization-contract";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { SeatPeakFoldState } from "../repositories/organization-seat-peak.repository.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import { RecordSeatChangedCommand, RecordSeatSnapshotCommand } from "./seat-peak.commands.ts";
import {
  SEAT_PEAK_AGGREGATE_TYPE,
  SEAT_PEAK_PIPELINE_NAME,
  seatChangedEventSchema,
  seatSnapshotTakenEventSchema,
} from "./seat-peak.events.ts";
import { SeatPeakFoldProjection } from "./seat-peak.projection.ts";

/** Opens an organization's count from every holder's seat as it stands. */
export type SeatPeakOpener = Readonly<{
  open: (input: { organizationId: string; occurredAt: number }) => Promise<void>;
}>;

type SeatPeakPipelineDependencies = Readonly<{
  store: StateProjectionStore<SeatPeakFoldState>;
  opener: SeatPeakOpener;
}>;

function seatPeakCommands({ store }: Pick<SeatPeakPipelineDependencies, "store">) {
  return definePipeline({
    name: SEAT_PEAK_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SEAT_PEAK_AGGREGATE_TYPE }),
  })
    .withEvents([seatChangedEventSchema, seatSnapshotTakenEventSchema])
    .withCommand("recordSeatChanged", RecordSeatChangedCommand)
    .withCommand("recordSeatSnapshot", RecordSeatSnapshotCommand)
    .withPostgresProjection(SeatPeakFoldProjection.create({ store }));
}

export type SeatPeakDefinition = ReturnType<ReturnType<typeof seatPeakCommands>["build"]>;

/**
 * organization_seat_peak: every seat change and the opening count, folded per organization. A new
 * organization opens from its holders as they stand once it exists, keyed by its creation moment.
 */
export function buildSeatPeakPipeline({
  store,
  opener,
}: SeatPeakPipelineDependencies): SeatPeakDefinition {
  return seatPeakCommands({ store })
    .withPeerSubscriber("seatPeakOrganizationCreated", {
      eventType: ORGANIZATION_CREATED_EVENT_TYPE,
      data: organizationCreatedEventDataSchema.pick({ organizationId: true, occurredAt: true }),
      handle: ({ organizationId, occurredAt }) => opener.open({ organizationId, occurredAt }),
    })
    .build();
}

export const seatPeakEventing = defineEventingModule({
  pipeline: SEAT_PEAK_PIPELINE_NAME,
  build: ({ app }: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    app.seatPeakPipeline(),
  connect: ({ app, commands }) => app.connectSeatPeak(commands),
});
