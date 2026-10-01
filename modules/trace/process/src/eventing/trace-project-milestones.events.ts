import { EventSchema } from "@langwatch/eventing";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  firstTraceRecordedEventDataSchema,
  TRACE_RECEIVED_EVENT_TYPE,
  traceReceivedEventDataSchema,
} from "@langwatch/trace-contract";
import { z } from "zod";

/** A project's trace milestones, decided by the project-metadata subscriber from folded state. */
export const TRACE_PROJECT_MILESTONES_PIPELINE_NAME = "trace_project_milestones" as const;
export const TRACE_PROJECT_AGGREGATE_TYPE = "project" as const;
export const TRACE_PROJECT_MILESTONES_EVENT_VERSION = "2026-10-01" as const;

export const RECORD_FIRST_TRACE_COMMAND_TYPE = "lw.trace.record_first_trace" as const;
export const RECORD_TRACE_RECEIVED_COMMAND_TYPE = "lw.trace.record_trace_received" as const;

export const recordFirstTraceCommandDataSchema = firstTraceRecordedEventDataSchema;
export type RecordFirstTraceCommandData = z.infer<typeof recordFirstTraceCommandDataSchema>;

export const recordTraceReceivedCommandDataSchema = traceReceivedEventDataSchema;
export type RecordTraceReceivedCommandData = z.infer<typeof recordTraceReceivedCommandDataSchema>;

const event = <Type extends string, Data extends z.ZodTypeAny>(type: Type, data: Data) =>
  z.object({
    ...EventSchema.shape,
    type: z.literal(type),
    version: z.literal(TRACE_PROJECT_MILESTONES_EVENT_VERSION),
    data,
  });

export const firstTraceRecordedEventSchema = event(
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  recordFirstTraceCommandDataSchema,
);
export const traceReceivedEventSchema = event(
  TRACE_RECEIVED_EVENT_TYPE,
  recordTraceReceivedCommandDataSchema,
);
export type FirstTraceRecordedEvent = z.infer<typeof firstTraceRecordedEventSchema>;
export type TraceReceivedEvent = z.infer<typeof traceReceivedEventSchema>;
