import type { TraceEditOverlayAuthor, TraceEditOverlayPatch } from "@langwatch/trace-contract";

/**
 * One stored reviewer correction, with the two attribution lines a trace view renders. patch is the raw stored document — the service parses it, since a document this build can't interpret must read as no correction, not a failed trace read.
 */
export interface TraceEditOverlayRow {
  id: string;
  projectId: string;
  traceId: string;
  patch: unknown;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: TraceEditOverlayAuthor | null;
  updatedBy: TraceEditOverlayAuthor | null;
}

/**
 * Reads and writes the reviewer correction stored for a trace. There is at most
 * one per trace, so every write is an upsert.
 */
export abstract class TraceEditOverlayRepository {
  abstract tryFindByProjectAndTrace(params: {
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
