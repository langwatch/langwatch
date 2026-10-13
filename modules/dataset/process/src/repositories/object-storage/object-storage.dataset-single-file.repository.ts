import type { ObjectStorage } from "@langwatch/process-stores/members";

import { singleFileKey } from "../../rules/dataset-single-file.rules.ts";
import type {
  DatasetSingleFile,
  DatasetSingleFileRepository,
} from "../dataset-single-file.repository.ts";

/** Single-file datasets in object storage, at the last release's `datasets/<project>/<dataset>`. */
export class ObjectStorageDatasetSingleFileRepository implements DatasetSingleFileRepository {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageDatasetSingleFileRepository {
    return new ObjectStorageDatasetSingleFileRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async getSingleFile(input: { datasetId: string; projectId: string }): Promise<DatasetSingleFile> {
    const at = { projectId: input.projectId, key: singleFileKey(input) };
    let body: AsyncIterable<Uint8Array>;
    try {
      body = await this.objects.read(at);
    } catch (error) {
      if (error instanceof Error && error.name === "StoredObjectNotFoundError") {
        return { outcome: "missing" };
      }
      throw error;
    }
    const decoder = new TextDecoder();
    let text = "";
    for await (const part of body) text += decoder.decode(part, { stream: true });
    return { outcome: "found", text: text + decoder.decode() };
  }
}
