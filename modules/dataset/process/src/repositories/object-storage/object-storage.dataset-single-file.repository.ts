import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";

import { singleFileKey } from "../../rules/dataset-single-file.rules.ts";
import type {
  DatasetSingleFile,
  DatasetSingleFileRead,
  DatasetSingleFileRepository,
} from "../dataset-single-file.repository.ts";

const JSON_MEDIA_TYPE = "application/json";

/** Single-file datasets in object storage, at the previous release's key. */
export class ObjectStorageDatasetSingleFileRepository implements DatasetSingleFileRepository {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageDatasetSingleFileRepository {
    return new ObjectStorageDatasetSingleFileRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async getSingleFile(input: DatasetSingleFileRead): Promise<DatasetSingleFile> {
    let body: AsyncIterable<Uint8Array>;
    try {
      body = await this.objects.read(addressOf(input));
    } catch (error) {
      if (error instanceof Error && error.name === "StoredObjectNotFoundError") {
        return { outcome: "missing" };
      }
      throw error;
    }
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for await (const part of body) {
      bytes += part.byteLength;
      if (input.maxBytes !== undefined && bytes > input.maxBytes) {
        return { outcome: "too_large", sizeBytes: bytes };
      }
      text += decoder.decode(part, { stream: true });
    }
    return { outcome: "found", text: text + decoder.decode() };
  }

  async putSingleFile(input: {
    datasetId: string;
    projectId: string;
    text: string;
  }): Promise<void> {
    const bytes = new TextEncoder().encode(input.text);
    await this.objects.write(addressOf(input), once(bytes), {
      byteLength: bytes.byteLength,
      contentType: JSON_MEDIA_TYPE,
    });
  }
}

function addressOf(input: { datasetId: string; projectId: string }): StoredObjectAddress {
  return { projectId: input.projectId, key: singleFileKey(input) };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
