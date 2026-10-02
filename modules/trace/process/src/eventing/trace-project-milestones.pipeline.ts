import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { TraceModule } from "../app/trace.app.ts";
import {
  RecordFirstTraceCommand,
  RecordTraceReceivedCommand,
} from "./trace-project-milestones.commands.ts";
import {
  firstTraceRecordedEventSchema,
  TRACE_PROJECT_AGGREGATE_TYPE,
  TRACE_PROJECT_MILESTONES_PIPELINE_NAME,
  traceReceivedEventSchema,
} from "./trace-project-milestones.events.ts";

function milestoneCommands() {
  return definePipeline({
    name: TRACE_PROJECT_MILESTONES_PIPELINE_NAME,
    aggregate: defineAggregate({ type: TRACE_PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents([firstTraceRecordedEventSchema, traceReceivedEventSchema])
    .withCommand("recordFirstTrace", RecordFirstTraceCommand)
    .withCommand("recordTraceReceived", RecordTraceReceivedCommand);
}

export type TraceProjectMilestonesDefinition = ReturnType<
  ReturnType<typeof milestoneCommands>["build"]
>;

/** trace_project_milestones records; peers (nurturing) react to its events from their side (§9). */
export function buildTraceProjectMilestonesPipeline(): TraceProjectMilestonesDefinition {
  return milestoneCommands().build();
}

export const traceProjectMilestonesEventing = defineEventingModule({
  pipeline: TRACE_PROJECT_MILESTONES_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, TraceModule>) => app.projectMilestonesPipeline(),
  connect: ({ app, commands }) => app.connectProjectMilestones(commands),
});
