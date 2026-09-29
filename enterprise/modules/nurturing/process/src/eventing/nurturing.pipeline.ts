// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { NurturingApp } from "../app/nurturing.app.ts";
import { RecordNurturingSignalCommand } from "./nurturing-signal.commands.ts";
import {
  NURTURING_PIPELINE_NAME,
  NURTURING_SIGNAL_AGGREGATE_TYPE,
  NURTURING_SIGNAL_RECORDED_EVENT_TYPE,
  type NurturingSignalRecordedEvent,
  nurturingSignalRecordedEventSchema,
  type RecordNurturingSignalCommandData,
} from "./nurturing-signal.events.ts";

export type NurturingPipeline = StaticPipelineDefinition<
  NurturingSignalRecordedEvent,
  Record<string, never>,
  { name: "recordSignal"; payload: RecordNurturingSignalCommandData }
>;

/** Owners' commands land here as events; the worker's subscriber sends each one out. */
export function buildNurturingPipeline(deps: {
  deliver: (input: { key: string; signal: NurturingSignal }) => Promise<void>;
}): NurturingPipeline {
  return definePipeline({
    name: NURTURING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: NURTURING_SIGNAL_AGGREGATE_TYPE }),
  })
    .withEvents([nurturingSignalRecordedEventSchema])
    .withEventSubscriber("deliverSignal", {
      events: [NURTURING_SIGNAL_RECORDED_EVENT_TYPE],
      handler: (event: NurturingSignalRecordedEvent) =>
        deps.deliver({ key: event.aggregateId, signal: event.data.signal }),
    })
    .withCommand("recordSignal", RecordNurturingSignalCommand)
    .build();
}

export const nurturingEventing = defineEventingModule({
  pipeline: NURTURING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, NurturingApp>) => app.pipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
