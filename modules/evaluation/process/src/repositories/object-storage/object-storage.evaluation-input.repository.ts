import { createHash } from "node:crypto";

import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";

import type { EvaluationInputStorage } from "../../app/evaluation.members.ts";

const JSON_MEDIA_TYPE = "application/json";
const STORED_INPUT_ID = /^[a-f0-9]{64}$/u;

/** Oversized evaluation inputs over the process's `objectStorage` member, at main's object keys. */
export class ObjectStorageEvaluationInputRepository implements EvaluationInputStorage {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageEvaluationInputRepository {
    return new ObjectStorageEvaluationInputRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const id = createHash("sha256").update(input.evaluationId).digest("hex");
    await this.objects.write(addressOf(input.tenantId, id), once(input.bytes), {
      byteLength: input.bytes.byteLength,
      contentType: JSON_MEDIA_TYPE,
    });

    return { id };
  }

  async tryRead(input: {
    tenantId: string;
    id: string;
  }): Promise<AsyncIterable<Uint8Array> | null> {
    if (!STORED_INPUT_ID.test(input.id)) return null;

    try {
      return await this.objects.read(addressOf(input.tenantId, input.id));
    } catch (error) {
      if (error instanceof Error && error.name === "StoredObjectNotFoundError") return null;
      throw error;
    }
  }
}

function addressOf(tenantId: string, id: string): StoredObjectAddress {
  return { projectId: tenantId, key: `${tenantId}/evaluation-inputs/${id}.json` };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
