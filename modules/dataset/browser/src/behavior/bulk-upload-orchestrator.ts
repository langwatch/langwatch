/** Bulk upload orchestration core: concurrent workers + single-file pipeline
 * (upload, then create the dataset from it). Injected deps for testability.
 */

import type { DatasetConfirmColumns } from "@langwatch/dataset-contract";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { DATASET_IMPORT_PURPOSE } from "@langwatch/stored-object-contract";

import type { DatasetImportTransport } from "./use-stored-object-upload.ts";

export class DatasetNameConflictError extends Error {
  constructor(message = "A dataset with this name already exists") {
    super(message);
    this.name = "DatasetNameConflictError";
  }
}

/** Max times we re-attempt the CREATE under a bumped name on a slug conflict
 *  before giving up (a pathological run where every candidate is taken). */
export const MAX_NAME_CONFLICT_RETRIES = 25;

/**
 * Run `items` through `worker` with at most `cap` in flight. `worker` MUST NOT
 * throw — each item owns its own success/failure (per-file independence); a
 * throwing worker would reject the whole pool. Resolves when every item is done.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  cap: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const pump = async (): Promise<void> => {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index]!, index);
    return pump();
  };
  const lanes = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, () => pump());
  await Promise.all(lanes);
}

export type UploadSingleFileDeps = DatasetImportTransport;

export type UploadSingleFileResult = {
  datasetId: string;
  /** The name actually used (may differ from the requested one after a conflict
   *  retry) so the UI can reflect it. */
  finalName: string;
};

/**
 * Upload one file end to end: the file goes to storage once, then the dataset
 * is created from it. On a taken name it bumps the name via `nextName` and
 * creates again; the uploaded file is reused, never sent twice.
 */
export async function uploadSingleFile(
  params: {
    projectId: string;
    name: string;
    file: File;
    columnTypes?: DatasetConfirmColumns;
    signal?: AbortSignal;
    /** Produce the next candidate name when the current one conflicts. */
    nextName: (current: string) => string;
  },
  deps: UploadSingleFileDeps,
): Promise<UploadSingleFileResult> {
  const { projectId, file, columnTypes, signal, nextName } = params;
  const reference = await deps.uploadStoredObject({
    projectId,
    purpose: DATASET_IMPORT_PURPOSE,
    file,
    signal,
  });
  signal?.throwIfAborted();

  let name = params.name;
  for (let attempt = 0; attempt < MAX_NAME_CONFLICT_RETRIES; attempt++) {
    try {
      const { datasetId } = await deps.createFromStoredObject({
        projectId,
        name,
        storedObjectId: reference.id,
        columnTypes,
      });
      return { datasetId, finalName: name };
    } catch (error) {
      if (readHandledError(error)?.code !== "dataset_name_taken") throw error;
      name = nextName(name);
    }
  }

  throw new DatasetNameConflictError(`Could not find an available name for "${file.name}"`);
}
