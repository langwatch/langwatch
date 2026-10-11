import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";

import type { TraceModule } from "../app/trace.app.ts";
import {
  RecordFirstTraceCommand,
  RecordTraceFirstSeenCommand,
  RecordTraceReceivedCommand,
  RecordMonthTracesCountedCommand,
} from "./trace-project-milestones.commands.ts";
import {
  firstTraceRecordedEventSchema,
  TRACE_PROJECT_AGGREGATE_TYPE,
  TRACE_PROJECT_MILESTONES_PIPELINE_NAME,
  traceFirstSeenEventSchema,
  traceReceivedEventSchema,
  monthTracesCountedEventSchema,
} from "./trace-project-milestones.events.ts";

/** A day: far longer than one trace's first spans take to fold. */
const TRACE_FIRST_SEEN_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

function milestoneCommands(retention?: RetentionPolicyResolver) {
  const pipeline = definePipeline({
    name: TRACE_PROJECT_MILESTONES_PIPELINE_NAME,
    aggregate: defineAggregate({ type: TRACE_PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents([
      firstTraceRecordedEventSchema,
      traceReceivedEventSchema,
      traceFirstSeenEventSchema,
      monthTracesCountedEventSchema,
    ])
    .withCommand("recordFirstTrace", RecordFirstTraceCommand)
    .withCommand("recordTraceReceived", RecordTraceReceivedCommand)
    // One queued job per trace, by the event's own key, so a re-sent trace is not appended twice.
    .withCommand("recordTraceFirstSeen", RecordTraceFirstSeenCommand, {
      deduplication: {
        makeId: (data) => `${data.tenantId}:${data.traceId}`,
        ttlMs: TRACE_FIRST_SEEN_DEDUP_TTL_MS,
      },
    })
    .withCommand("recordMonthTracesCounted", RecordMonthTracesCountedCommand);
  return retention === undefined ? pipeline : pipeline.withRetention(retention);
}

export type TraceProjectMilestonesDefinition = ReturnType<
  ReturnType<typeof milestoneCommands>["build"]
>;

/** trace_project_milestones records; peers (nurturing, entitlement) react from their side (§9). */
export function buildTraceProjectMilestonesPipeline(
  retention?: RetentionPolicyResolver,
): TraceProjectMilestonesDefinition {
  return milestoneCommands(retention).build();
}

export const traceProjectMilestonesEventing = defineEventingModule({
  pipeline: TRACE_PROJECT_MILESTONES_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, TraceModule>) => app.projectMilestonesPipeline(),
  connect: ({ app, commands }) => app.connectProjectMilestones(commands),
});
