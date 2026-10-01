/**
 * An oversized engine payload, parked in the project's own object storage while
 * its invoke is in flight: main's `stagePayloadToS3`, over the process's member.
 * Precedent: evaluation's object-storage.langevals-payload-staging.channel.ts.
 */
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";

import type { NlpPayloadStaging, StagedNlpPayload } from "../../channels/nlp-lambda.channel.ts";

const logger = createLogger("langwatch:workflow:nlp-payload-staging");

const STAGED_PAYLOAD_RESOURCE = "nlpstagedpayload";

export class ObjectStorageNlpPayloadStagingRepository implements NlpPayloadStaging {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageNlpPayloadStagingRepository {
    return new ObjectStorageNlpPayloadStagingRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
  }): Promise<StagedNlpPayload> {
    const { projectId, keyPrefix, serialized, ttlSeconds } = input;
    const suffix = `${nowInstant().epochMilliseconds}-${generate(STAGED_PAYLOAD_RESOURCE).toString()}`;
    const at: StoredObjectAddress = { projectId, key: `${keyPrefix}/${suffix}.json` };

    await this.objects.write(at, once(serialized), {
      byteLength: serialized.byteLength,
      contentType: "application/json",
    });
    const url = await this.objects.signDownload(at, {
      expiresAt: nowInstant().add({ seconds: ttlSeconds }),
    });

    return { url, discard: () => this.discard(at) };
  }

  /** Best-effort: the bucket's lifecycle rule on the staging prefix reaps a miss. */
  private async discard(at: StoredObjectAddress): Promise<void> {
    try {
      await this.objects.remove(at);
    } catch (error) {
      logger.warn(
        { projectId: at.projectId, key: at.key, error },
        "could not drop a staged NLP engine payload; the lifecycle rule will reap it",
      );
    }
  }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
