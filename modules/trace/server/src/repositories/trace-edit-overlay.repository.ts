import type { TraceEditOverlayAuthor, TraceEditOverlayPatch } from "@langwatch/trace-contract";
import type { Instant } from "@langwatch/time";

/**
 * One stored reviewer correction with attribution lines a trace view renders.
 * patch is raw — service parses it; unparseable document reads as no
 * correction, not a failed trace read.
 */
export interface TraceEditOverlayRow {
  id: string;
  projectId: string;
  traceId: string;
  patch: unknown;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  createdBy: TraceEditOverlayAuthor | null;
  updatedBy: TraceEditOverlayAuthor | null;
}

/**
 * Reads and writes the reviewer correction stored for a trace. There is at most
 * one per trace, so every write is an upsert.
 */
export abstract class TraceEditOverlayRepository {
  abstract findByProjectAndTrace(params: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayRow | null>;

  abstract findAllByProjectAndTraces(params: {
    projectId: string;
    traceIds: string[];
  }): Promise<TraceEditOverlayRow[]>;

  abstract upsert(params: {
    projectId: string;
    traceId: string;
    patch: TraceEditOverlayPatch;
    userId: string | null;
  }): Promise<TraceEditOverlayRow>;

  abstract delete(params: { projectId: string; traceId: string }): Promise<void>;
}
