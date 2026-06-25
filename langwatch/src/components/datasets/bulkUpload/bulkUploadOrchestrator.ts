/**
 * Bulk upload (D3): the storage-agnostic orchestration core, decoupled from
 * React so the hard parts are unit-testable.
 *
 *  - `runWithConcurrency` runs N items through at most `cap` workers at once; the
 *    rest queue and start as slots free (the "queues the rest" behaviour).
 *  - `uploadSingleFile` is one file's pipeline: requestDirectUpload → PUT →
 *    finalize, reusing the single-upload primitives so S3-vs-local-vs-no-storage
 *    stays abstracted by URL shape. It retries the CREATE under a fresh name on a
 *    slug conflict (the batch-name race), and reaps the `uploading` row on any
 *    post-create failure or cancel (single-flow parity — nothing half-created).
 *
 * Both take their collaborators as injected deps so tests drive them with fakes.
 */

import type { DatasetColumns } from "~/server/datasets/types";
import {
  abortPendingUpload,
  DatasetNameConflictError,
  finalizeDirectUpload,
  putFileToPresignedUrl,
  requestDirectUpload,
} from "../services/directUpload";

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
  const lanes = Array.from(
    { length: Math.max(1, Math.min(cap, items.length)) },
    () => pump(),
  );
  await Promise.all(lanes);
}

export type UploadSingleFileDeps = {
  requestDirectUpload: typeof requestDirectUpload;
  putFileToPresignedUrl: typeof putFileToPresignedUrl;
  finalizeDirectUpload: typeof finalizeDirectUpload;
  abortPendingUpload: typeof abortPendingUpload;
};

const defaultDeps: UploadSingleFileDeps = {
  requestDirectUpload,
  putFileToPresignedUrl,
  finalizeDirectUpload,
  abortPendingUpload,
};

export type UploadSingleFileResult = {
  datasetId: string;
  /** The name actually used (may differ from the requested one after a conflict
   *  retry) so the UI can reflect it. */
  finalName: string;
};

/**
 * Upload one file end to end. On a slug conflict (the within-batch / concurrent
 * name race) it bumps the name via `nextName` and retries the CREATE — no row
 * exists yet on a conflict (the server rejects the name BEFORE minting one), so
 * the retry is clean. After the row IS created, any PUT/finalize failure OR a
 * caller cancel (AbortError) reaps the `uploading` row before rethrowing, so a
 * failed/cancelled file never leaves a half-created dataset behind.
 */
export async function uploadSingleFile(
  params: {
    projectId: string;
    name: string;
    file: File;
    columnTypes?: DatasetColumns;
    signal?: AbortSignal;
    /** Produce the next candidate name when the current one conflicts. */
    nextName: (current: string) => string;
  },
  deps: UploadSingleFileDeps = defaultDeps,
): Promise<UploadSingleFileResult> {
  const { projectId, file, columnTypes, signal, nextName } = params;
  let name = params.name;

  for (let attempt = 0; attempt < MAX_NAME_CONFLICT_RETRIES; attempt++) {
    let datasetId: string;
    let uploadUrl: string;
    try {
      const handle = await deps.requestDirectUpload({
        projectId,
        name,
        filename: file.name,
        columnTypes,
      });
      datasetId = handle.datasetId;
      uploadUrl = handle.uploadUrl;
    } catch (error) {
      // Conflict = the name (slug) is taken — no row was created, so just bump
      // the name and retry the create cleanly.
      if (error instanceof DatasetNameConflictError) {
        name = nextName(name);
        continue;
      }
      throw error;
    }

    // The row now exists. Reap ONLY on a PUT failure/cancel — at that point no
    // bytes finalized, so the `uploading` row is genuinely orphaned.
    try {
      await deps.putFileToPresignedUrl(uploadUrl, file, signal);
    } catch (error) {
      await deps
        .abortPendingUpload({ projectId, datasetId })
        .catch(() => undefined);
      throw error;
    }

    // PUT succeeded → committed to finalizing. A finalize failure must NOT reap:
    // finalize may have already committed server-side (a transport blip on the
    // response would otherwise delete a real dataset), and the reap is
    // status-guarded to `uploading` anyway — a still-`uploading` row is left to
    // the server's stale-upload TTL sweep, not blindly deleted here.
    await deps.finalizeDirectUpload({ projectId, datasetId });
    return { datasetId, finalName: name };
  }

  throw new DatasetNameConflictError(
    `Could not find an available name for "${file.name}"`,
  );
}
