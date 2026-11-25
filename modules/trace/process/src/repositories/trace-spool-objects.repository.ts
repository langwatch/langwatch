import type { Readable } from "node:stream";

/** Where a project's objects land; the spool's write guard decides by this alone. */
export type TraceSpoolDestinationKind = "s3" | "azure" | "file" | "memory";

/** One transient spool object, addressed by the project it belongs to and its key. */
export type TraceSpoolObjectAddress = Readonly<{ projectId: string; key: string }>;

/**
 * The transient spool's objects (ADR-022): an over-threshold record-span command,
 * written by the ingestion door and read back, then removed, by the worker.
 */
export abstract class TraceSpoolObjectsRepository {
  abstract destinationKind(projectId: string): Promise<TraceSpoolDestinationKind>;
  abstract write(at: TraceSpoolObjectAddress, body: Buffer): Promise<void>;
  /** Raises when the object is absent: a spooled span is never read back empty. */
  abstract read(at: TraceSpoolObjectAddress): Promise<Readable>;
  /** An absent object is already removed. */
  abstract remove(at: TraceSpoolObjectAddress): Promise<void>;
}
