import fs from "node:fs/promises";
import path from "node:path";

import { assertNoTraversal } from "../../rules/dataset-chunking.rules.ts";
import type {
  DatasetSingleFile,
  DatasetSingleFileRead,
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

  async getSingleFile(input: DatasetSingleFileRead): Promise<DatasetSingleFile> {
    const file = this.pathOf(input);
    try {
      if (input.maxBytes !== undefined) {
        const { size } = await fs.stat(file);
        if (size > input.maxBytes) return { outcome: "too_large", sizeBytes: size };
      }
      return { outcome: "found", text: await fs.readFile(file, "utf8") };
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
    // A crash mid-write must never truncate the file: write beside it, then rename over it.
    // Writers hold the dataset's lock, so one temporary name per dataset is enough.
    const written = `${file}.writing`;
    try {
      await fs.writeFile(written, input.text, "utf8");
      await fs.rename(written, file);
    } catch (error) {
      await fs.rm(written, { force: true });
      throw error;
    }
  }

  private pathOf(input: { datasetId: string; projectId: string }): string {
    assertNoTraversal(input.projectId, input.datasetId);
    return path.join(this.root, input.projectId, input.datasetId);
  }
}
