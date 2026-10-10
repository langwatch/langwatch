import type { Readable } from "node:stream";

/** The v1 spool, where a reference is the object key itself. Read back for one release only. */
export interface TraceLegacySpool {
  openRead(input: { projectId: string; key: string }): Promise<Readable>;
  delete(input: { projectId: string; key: string }): Promise<void>;
}
