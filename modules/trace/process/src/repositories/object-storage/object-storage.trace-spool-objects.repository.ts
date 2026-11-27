import type { Readable } from "node:stream";

import type { ObjectStorage } from "@langwatch/process-stores";
import { readableBody } from "@langwatch/process-stores/members";

import {
  type TraceSpoolDestinationKind,
  type TraceSpoolObjectAddress,
  TraceSpoolObjectsRepository,
} from "../trace-spool-objects.repository.ts";

const SPOOL_MEDIA_TYPE = "application/octet-stream";

/**
 * The spool over the process's `objectStorage` member, which places each project on its
 * organization's own account or the shared one, the same backend every other object uses.
 */
export class ObjectStorageTraceSpoolObjectsRepository extends TraceSpoolObjectsRepository {
  static create(input: {
    objectStorage: Pick<ObjectStorage, "destination" | "write" | "read" | "remove">;
  }): ObjectStorageTraceSpoolObjectsRepository {
    return new ObjectStorageTraceSpoolObjectsRepository(input.objectStorage);
  }

  private constructor(
    private readonly objects: Pick<ObjectStorage, "destination" | "write" | "read" | "remove">,
  ) {
    super();
  }

  async destinationKind(projectId: string): Promise<TraceSpoolDestinationKind> {
    return (await this.objects.destination(projectId)).kind;
  }

  async write(at: TraceSpoolObjectAddress, body: Buffer): Promise<void> {
    await this.objects.write(at, once(body), {
      byteLength: body.byteLength,
      contentType: SPOOL_MEDIA_TYPE,
    });
  }

  async read(at: TraceSpoolObjectAddress): Promise<Readable> {
    const body = await this.objects.read(at);
    return readableBody(body);
  }

  async remove(at: TraceSpoolObjectAddress): Promise<void> {
    await this.objects.remove(at);
  }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
