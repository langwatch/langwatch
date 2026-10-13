import fs from "node:fs/promises";
import path from "node:path";

import { assertNoTraversal } from "../../rules/dataset-chunking.rules.ts";
import type {
  DatasetSingleFile,
  DatasetSingleFileRepository,
} from "../dataset-single-file.repository.ts";

/** The previous release's default when `LOCAL_STORAGE_PATH` was unset: `storage` in its cwd. */
const PREVIOUS_RELEASE_DEFAULT_PATH = "storage";

/** Single-file datasets the previous release kept on disk, at `<path>/<project>/<dataset>`. */
export class FilesystemDatasetSingleFileRepository implements DatasetSingleFileRepository {
  static create(input: { localPath: string | undefined }): FilesystemDatasetSingleFileRepository {
    return new FilesystemDatasetSingleFileRepository(
      path.resolve(input.localPath ?? PREVIOUS_RELEASE_DEFAULT_PATH),
    );
  }

  private constructor(private readonly root: string) {}

  async getSingleFile(input: { datasetId: string; projectId: string }): Promise<DatasetSingleFile> {
    try {
      return { outcome: "found", text: await fs.readFile(this.pathOf(input), "utf8") };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { outcome: "missing" };
      }
      throw error;
    }
  }

  async putSingleFile(input: {
    datasetId: string;
    projectId: string;
    text: string;
  }): Promise<void> {
    const file = this.pathOf(input);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, input.text, "utf8");
  }

  private pathOf(input: { datasetId: string; projectId: string }): string {
    assertNoTraversal(input.projectId, input.datasetId);
    return path.join(this.root, input.projectId, input.datasetId);
  }
}
