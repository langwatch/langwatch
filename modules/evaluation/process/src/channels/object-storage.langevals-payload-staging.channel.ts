import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";

import type { LangevalsPayloadStaging, StagedLangevalsPayload } from "./langevals.channel.ts";

const logger = createLogger("langwatch:langevals:stagePayload");

const STAGED_PAYLOAD_RESOURCE = "langevalspayload";

/** A port of main's `stagePayloadToS3`, over the process's object storage member. */
export class ObjectStorageLangevalsPayloadStaging implements LangevalsPayloadStaging {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageLangevalsPayloadStaging {
    return new ObjectStorageLangevalsPayloadStaging(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
    signal?: AbortSignal | undefined;
  }): Promise<StagedLangevalsPayload> {
    const { projectId, keyPrefix, serialized, ttlSeconds, signal } = input;
    const at: StoredObjectAddress = {
      projectId,
      key: `${keyPrefix}/${nowInstant().epochMilliseconds}-${generate(STAGED_PAYLOAD_RESOURCE).toString()}.json`,
    };

    signal?.throwIfAborted();
    await this.objects.write(at, once(serialized), {
      byteLength: serialized.byteLength,
      contentType: "application/json",
    });
    logger.debug(
      { projectId, key: at.key, bytes: serialized.byteLength },
      "uploaded staged payload to object storage",
    );
    signal?.throwIfAborted();

    const url = await this.objects.signDownload(at, {
      expiresAt: nowInstant().add({ seconds: ttlSeconds }),
    });

    return { url, discard: () => this.discard(at) };
  }

  private async discard(at: StoredObjectAddress): Promise<void> {
    try {
      await this.objects.remove(at);
      logger.debug({ projectId: at.projectId, key: at.key }, "deleted staged payload after use");
    } catch (error) {
      logger.warn(
        { projectId: at.projectId, key: at.key, error },
        "failed to delete staged payload (lifecycle rule will reap it)",
      );
    }
  }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
