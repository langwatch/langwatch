import { createHash } from "node:crypto";

import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";

import {
  evaluationInputKey,
  isEvaluationInputKeyOf,
} from "../../rules/evaluation-input-object.rules.ts";
import type {
  EvaluationInputRepository,
  StoredEvaluationInput,
} from "../evaluation-input.repository.ts";

const JSON_MEDIA_TYPE = "application/json";

/** Refused by name: this destination cannot expire the object a lifecycle rule would reap. */
export class EvaluationInputDestinationUnsupportedError extends Error {
  readonly code = "evaluation_input_destination_unsupported";

  constructor(destinationKind: string) {
    super(
      `Oversized evaluation inputs need a destination whose lifecycle rule expires them; the ${destinationKind} destination cannot.`,
    );
    this.name = "EvaluationInputDestinationUnsupportedError";
  }
}

/** Oversized evaluation inputs over the process's `objectStorage` member (ADR-172). */
export class ObjectStorageEvaluationInputRepository implements EvaluationInputRepository {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageEvaluationInputRepository {
    return new ObjectStorageEvaluationInputRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async store(
    input: Parameters<EvaluationInputRepository["store"]>[0],
  ): Promise<{ key: string; sha256: string }> {
    const destination = await this.objects.destination(input.tenantId);
    if (destination.kind === "file") throw new EvaluationInputDestinationUnsupportedError("file");

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const key = evaluationInputKey({
      retentionClass: input.retentionClass,
      tenantId: input.tenantId,
      sha256,
    });
    await this.objects.write(addressOf(input.tenantId, key), once(input.bytes), {
      byteLength: input.bytes.byteLength,
      contentType: JSON_MEDIA_TYPE,
    });

    return { key, sha256 };
  }

  async read(input: { tenantId: string; key: string }): Promise<StoredEvaluationInput> {
    if (!isEvaluationInputKeyOf(input)) return { kind: "absent" };

    try {
      return {
        kind: "stored",
        body: await this.objects.read(addressOf(input.tenantId, input.key)),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "StoredObjectNotFoundError") {
        return { kind: "absent" };
      }
      throw error;
    }
  }
}

function addressOf(tenantId: string, key: string): StoredObjectAddress {
  return { projectId: tenantId, key };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
