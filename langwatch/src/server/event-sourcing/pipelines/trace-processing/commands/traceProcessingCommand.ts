import type { Command } from "../../../library";

/**
 * Base trace processing command types.
 */
export type TraceProcessingCommandType =
  | "lw.obs.trace.projection.rebuild"
  | "lw.obs.trace.projection.rebuild_force"
  | "lw.obs.trace.projection.rebuild_bulk";

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
  type: "lw.obs.trace.projection.rebuild";
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
  type: "lw.obs.trace.projection.rebuild_force";
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
  type: "lw.obs.trace.projection.rebuild_bulk";
}

export type TraceProcessingCommand =
  | RebuildTraceProjectionCommand
  | ForceRebuildTraceProjectionCommand
  | BulkRebuildTraceProjectionsCommand;
