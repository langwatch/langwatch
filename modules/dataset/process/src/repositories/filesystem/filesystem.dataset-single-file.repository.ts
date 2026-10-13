import fs from "node:fs/promises";
import path from "node:path";

import { assertNoTraversal } from "../../rules/dataset-chunking.rules.ts";
import type {
  DatasetSingleFile,
  DatasetSingleFileRepository,
} from "../dataset-single-file.repository.ts";

/** The previous release's default when `LOCAL_STORAGE_PATH` was unset: `storage` in its cwd. */
const PREVIOUS_RELEASE_DEFAULT_PATH = "storage";

/** Single-file datasets the last release kept on local disk, at `<path>/<project>/<dataset>`. */
export class FilesystemDatasetSingleFileRepository implements DatasetSingleFileRepository {
  static create(input: { localPath: string | undefined }): FilesystemDatasetSingleFileRepository {
    return new FilesystemDatasetSingleFileRepository(
      path.resolve(input.localPath ?? PREVIOUS_RELEASE_DEFAULT_PATH),
    );
  }

  private constructor(private readonly root: string) {}

  async getSingleFile(input: { datasetId: string; projectId: string }): Promise<DatasetSingleFile> {
    assertNoTraversal(input.projectId, input.datasetId);
    try {
      const text = await fs.readFile(
        path.join(this.root, input.projectId, input.datasetId),
        "utf8",
      );
      return { outcome: "found", text };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { outcome: "missing" };
      }
      throw error;
    }
  }
}
