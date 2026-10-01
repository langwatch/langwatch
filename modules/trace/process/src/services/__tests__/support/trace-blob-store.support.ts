import { vi } from "vitest";

import { S3TraceLegacySpoolChannel } from "../../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { BlobNotFoundError, TraceBlobStoreService } from "../../trace-blob-store.service.ts";

type EventLogRead = Parameters<TraceBlobStoreService["getFromEventLog"]>[0];

/** A real blob store whose event_log read is scripted; these tests never reach the spool. */
export function blobStoreReading(
  read: (request: EventLogRead) => Promise<string>,
): TraceBlobStoreService {
  const store = TraceBlobStoreService.create({
    legacySpool: S3TraceLegacySpoolChannel.create({
      resolveS3Client: async () => {
        throw new Error("spool storage is not part of this test");
      },
    }),
  });
  vi.spyOn(store, "getFromEventLog").mockImplementation(read);
  return store;
}

/** A real blob store answering each offloaded field from `values`, a missing row otherwise. */
export function blobStoreResolving(values: Record<string, string>): TraceBlobStoreService {
  return blobStoreReading(async ({ eventId, field, tenantId }) => {
    const value = values[field];
    if (value === undefined) {
      throw new BlobNotFoundError(eventId, field, tenantId);
    }
    return value;
  });
}

/** A real blob store with no ClickHouse client, as such a deployment runs; its read is spied. */
export function blobStoreWithoutClickHouse(): TraceBlobStoreService {
  const store = TraceBlobStoreService.create({
    legacySpool: S3TraceLegacySpoolChannel.create({
      resolveS3Client: async () => {
        throw new Error("spool storage is not part of this test");
      },
    }),
  });
  vi.spyOn(store, "getFromEventLog");
  return store;
}
