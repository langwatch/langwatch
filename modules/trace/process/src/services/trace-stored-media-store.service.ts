import type { StoredObjectApi } from "@langwatch/stored-object-contract";

import type { TraceMediaStore } from "../app/trace.members.ts";

const TRACE_MEDIA_FILENAME = "trace-media";

/** Trace content media, held by Stored Object and read back behind `traces:view`. */
export class TraceStoredMediaStoreService implements TraceMediaStore {
  static create(storedObjects: StoredObjectApi): TraceStoredMediaStoreService {
    return new TraceStoredMediaStoreService(storedObjects);
  }

  private constructor(private readonly storedObjects: StoredObjectApi) {}

  async storeFromBytes(input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }> {
    const stored = await this.storedObjects.storeFromBytes({
      ...input,
      filename: TRACE_MEDIA_FILENAME,
      audience: "traces:view",
    });

    return {
      id: stored.reference.id,
      mediaType: stored.reference.mediaType,
      isDuplicate: stored.isDuplicate,
    };
  }
}
