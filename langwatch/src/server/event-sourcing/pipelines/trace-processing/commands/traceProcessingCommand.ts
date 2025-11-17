import type { Command } from "../../../library";
import type { RecordSpanProcessingCommandData } from "../../span-processing/types";

/**
 * Base trace processing command types.
 */
export type TraceProcessingCommandType =
  | "trace.rebuild_projection"
  | "trace.force_rebuild"
  | "trace.bulk_rebuild"
  | "trace.record_span_ingestion";

/**
 * Command to rebuild a trace projection from stored events.
 */
export interface RebuildTraceProjectionCommand
  extends Command<
    string,
    {
      traceId: string;
      spanId?: string;
      force?: boolean;
    }
  > {
  type: "trace.rebuild_projection";
}

/**
 * Command to force rebuild a trace projection even if it exists.
 */
export interface ForceRebuildTraceProjectionCommand
  extends Command<
    string,
    {
      traceId: string;
    }
  > {
  type: "trace.force_rebuild";
}

/**
 * Command to bulk rebuild trace projections.
 */
export interface BulkRebuildTraceProjectionsCommand
  extends Command<
    string,
    {
      batchSize?: number;
      cursor?: string;
      resumeFromCount?: number;
    }
  > {
  type: "trace.bulk_rebuild";
}

/**
 * Command to record a span processing event and trigger projection rebuild.
 */
export interface RecordSpanProcessingCommand
  extends Command<string, RecordSpanProcessingCommandData> {
  type: "trace.record_span_ingestion";
}

export type TraceProcessingCommand =
  | RebuildTraceProjectionCommand
  | ForceRebuildTraceProjectionCommand
  | BulkRebuildTraceProjectionsCommand
  | RecordSpanProcessingCommand;
