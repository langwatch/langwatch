import { type Mock, vi } from "vitest";

import { S3TraceLegacySpoolChannel } from "../../../channels/s3/s3.trace-legacy-spool.channel.ts";
import {
  BlobNotFoundError,
  TraceBlobStoreService,
} from "../../../features/media/services/trace-blob-store.service.ts";
import { TracePayloadReaderRepository } from "../../../repositories/trace-payload-reader.repository.ts";

/** One offloaded field read, as the scripted event_log answers it. */
export type EventLogFieldRead = {
  tenantId: string;
  traceId: string;
  eventId: string;
  field: string;
};

type ReadFields = TracePayloadReaderRepository["readFields"];

/**
 * A payload reader whose event reads are scripted. `readFields` is the real seam under the real
 * `recall`, so a test sees the reads the production code would issue: one per trace event.
 */
class ScriptedPayloadReader extends TracePayloadReaderRepository {
  readonly readFields: Mock<ReadFields>;

  constructor(read: (request: EventLogFieldRead) => Promise<string>) {
    super();
    this.readFields = vi.fn<ReadFields>(async ({ tenantId, traceId, eventId, fields }) => {
      const values = new Map<string, string>();
      for (const field of fields) {
        values.set(field, await read({ tenantId, traceId, eventId, field }));
      }
      return values;
    });
  }
}

const readersByStore = new WeakMap<TraceBlobStoreService, ScriptedPayloadReader>();

function storeOver(payloads?: ScriptedPayloadReader): TraceBlobStoreService {
  const store = TraceBlobStoreService.create({
    legacySpool: S3TraceLegacySpoolChannel.create({
      resolveS3Client: async () => {
        throw new Error("spool storage is not part of this test");
      },
    }),
    ...(payloads ? { payloads } : {}),
  });
  if (payloads) readersByStore.set(store, payloads);
  return store;
}

/**
 * A real blob store whose event_log read is scripted, one call of `read` per requested field; these
 * tests never reach the spool. A `read` that throws fails the whole event it was asked for.
 */
export function blobStoreReading(
  read: (request: EventLogFieldRead) => Promise<string>,
): TraceBlobStoreService {
  return storeOver(new ScriptedPayloadReader(read));
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

/** A real blob store with no payload reader, as such a deployment runs. */
export function blobStoreWithoutClickHouse(): TraceBlobStoreService {
  return storeOver();
}

/** The event reads a scripted store served: one `readFields` call per trace event. */
export function eventLogReads(store: TraceBlobStoreService): Mock<ReadFields> {
  const reader = readersByStore.get(store);
  if (!reader) throw new Error("this blob store has no scripted payload reader");
  return reader.readFields;
}
