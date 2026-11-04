/**
 * A dataset version's rows over the process's `objectStorage` member, beside the
 * dataset's own chunks: `datasets/<project>/<dataset>/versions/<version id>/chunk-NNNNN.jsonl`.
 */
import { assertNoTraversal, type DatasetVersionRow } from "@langwatch/dataset-contract";
import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";

import { parseJsonl } from "../../rules/dataset-chunking.rules.ts";
import { stableStringify } from "../../rules/dataset-version.rules.ts";
import type { DatasetVersionContentRepository } from "../dataset-version-content.repository.ts";

const JSONL_MEDIA_TYPE = "application/x-ndjson";

export class ObjectStorageDatasetVersionContentRepository implements DatasetVersionContentRepository {
  static create(input: {
    objectStorage: ObjectStorage;
  }): ObjectStorageDatasetVersionContentRepository {
    return new ObjectStorageDatasetVersionContentRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async writeChunk(input: {
    projectId: string;
    datasetId: string;
    versionId: string;
    index: number;
    rows: readonly DatasetVersionRow[];
  }): Promise<void> {
    const text = input.rows.map((row) => `${stableStringify(row)}\n`).join("");
    const bytes = new TextEncoder().encode(text);
    await this.objects.write(addressOf(input), once(bytes), {
      byteLength: bytes.byteLength,
      contentType: JSONL_MEDIA_TYPE,
    });
  }

  async readChunk(input: {
    projectId: string;
    datasetId: string;
    versionId: string;
    index: number;
  }): Promise<unknown[]> {
    const body = await this.objects.read(addressOf(input));
    const decoder = new TextDecoder();
    let text = "";
    for await (const part of body) text += decoder.decode(part, { stream: true });
    return parseJsonl(text + decoder.decode());
  }

  async deleteChunks(input: {
    projectId: string;
    datasetId: string;
    versionId: string;
    chunkCount: number;
  }): Promise<void> {
    for (let index = 0; index < input.chunkCount; index++) {
      await this.objects.remove(addressOf({ ...input, index }));
    }
  }
}

function addressOf(input: {
  projectId: string;
  datasetId: string;
  versionId: string;
  index: number;
}): StoredObjectAddress {
  assertNoTraversal(input.projectId, input.datasetId, input.versionId);
  const chunk = String(input.index).padStart(5, "0");
  return {
    projectId: input.projectId,
    key: `datasets/${input.projectId}/${input.datasetId}/versions/${input.versionId}/chunk-${chunk}.jsonl`,
  };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
