import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
} from "@langwatch/eventing";
import {
  ORGANIZATION_CREATED_EVENT_TYPE,
  organizationCreatedEventDataSchema,
} from "@langwatch/organization-contract";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  SEAT_PEAK_PROCESS_NAME,
  SEAT_PEAK_PRUNE_INTENT,
  SEAT_PEAK_RECORD_INTENT,
} from "../rules/seat-change.rules.ts";
import {
  type SeatPeakCorrections,
  withSeatCorrections,
} from "./seat-peak-correction.subscriber.ts";
import { type SeatPeakFolder, seatPeakFoldSubscriber } from "./seat-peak-fold.subscriber.ts";
import { RecordSeatChangedCommand, RecordSeatSnapshotCommand } from "./seat-peak.commands.ts";
import {
  SEAT_PEAK_AGGREGATE_TYPE,
  SEAT_PEAK_PIPELINE_NAME,
  recordSeatChangedCommandDataSchema,
  seatChangedEventSchema,
  seatSnapshotTakenEventSchema,
} from "./seat-peak.events.ts";
import {
  pruneSeatChangeIntents,
  recordSeatChanged,
  type SeatPeakSender,
} from "./seat-peak.intent.ts";
import {
  SEAT_PEAK_MAX_ATTEMPTS,
  SEAT_PEAK_PROCESS_INITIAL_STATE,
  SEAT_PEAK_PRUNE_INTERVAL_MS,
  seatPeakProcessStateSchema,
  seatPeakPruneSchema,
  seatPeakPruneWake,
} from "./seat-peak.process.ts";

/** Opens an organization's count from every holder's seat as it stands. */
export type SeatPeakOpener = Readonly<{
  open: (input: { organizationId: string; occurredAt: number }) => Promise<void>;
}>;

type SeatPeakPipelineDependencies = Readonly<{
  fold: SeatPeakFolder;
  opener: SeatPeakOpener;
  /** The seat-change sender; it throws until this pipeline registers, so a delivery retries. */
  sender: () => SeatPeakSender;
  retention: Pick<ProcessStore, "deleteDispatchedBefore">;
  corrections: SeatPeakCorrections;
}>;

function seatPeakCommands({
  fold,
  sender,
  retention,
}: Pick<SeatPeakPipelineDependencies, "fold" | "sender" | "retention">) {
  return definePipeline({
    name: SEAT_PEAK_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SEAT_PEAK_AGGREGATE_TYPE }),
  })
    .withEvents([seatChangedEventSchema, seatSnapshotTakenEventSchema])
    .withCommand("recordSeatChanged", RecordSeatChangedCommand)
    .withCommand("recordSeatSnapshot", RecordSeatSnapshotCommand)
    .withEventSubscriber("seatPeakFold", seatPeakFoldSubscriber(fold))
    .withProcessManager(SEAT_PEAK_PROCESS_NAME, (pm) =>
      pm
        .state(seatPeakProcessStateSchema, SEAT_PEAK_PROCESS_INITIAL_STATE)
        .intent(
          SEAT_PEAK_RECORD_INTENT,
          recordSeatChangedCommandDataSchema,
          recordSeatChanged(sender),
        )
        .intent(SEAT_PEAK_PRUNE_INTENT, seatPeakPruneSchema, pruneSeatChangeIntents(retention))
        .schedule({ everyMs: SEAT_PEAK_PRUNE_INTERVAL_MS })
        .onWake(seatPeakPruneWake)
        .outbox({ maxAttempts: SEAT_PEAK_MAX_ATTEMPTS }),
    );
}

export type SeatPeakDefinition = ReturnType<ReturnType<typeof seatPeakCommands>["build"]>;

/**
 * organization_seat_peak: every seat change and the opening count, folded per organization. A new
 * organization opens from its holders as they stand once it exists, keyed by its creation moment.
 * The outbox delivers the changes writes commit (ADR-002 §1).
 */
export function buildSeatPeakPipeline({
  fold,
  opener,
  sender,
  retention,
  corrections,
}: SeatPeakPipelineDependencies): SeatPeakDefinition {
  const pipeline = seatPeakCommands({ fold, sender, retention }).withPeerSubscriber(
    "seatPeakOrganizationCreated",
    {
      eventType: ORGANIZATION_CREATED_EVENT_TYPE,
      data: organizationCreatedEventDataSchema.pick({ organizationId: true, occurredAt: true }),
      handle: ({ organizationId, occurredAt }) => opener.open({ organizationId, occurredAt }),
    },
  );
  // Seats moved by writes organization does not make (ADR-002 §6).
  return withSeatCorrections({ pipeline, corrections }).build();
}

export const seatPeakEventing = defineEventingModule({
  pipeline: SEAT_PEAK_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    app.seatPeakPipeline({ processStore }),
  connect: ({ app, commands }) => app.connectSeatPeak(commands),
});
