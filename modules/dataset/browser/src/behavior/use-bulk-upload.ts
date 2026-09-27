/** Fire-and-forget orchestrator (not a React effect): closing drawer doesn't
 * abort in-flight files.
 */
import { describeError } from "@langwatch/browser-host/errors";
import type {
  DatasetConfirmColumns,
  RetryNormalizeInput,
  UploadProcessing,
} from "@langwatch/dataset-contract";
import { detectFileFormat } from "@langwatch/dataset-contract";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { generate } from "@langwatch/ksuid";
import { useCallback, useRef, useState } from "react";

import { baseNameFromFilename, batchDedupeNames, bumpName } from "../model/batch-name-dedup.ts";
import { parseHeaderColumns } from "../model/parse-header-columns.ts";
import {
  runWithConcurrency,
  uploadSingleFile,
  type UploadSingleFileDeps,
} from "./bulk-upload-orchestrator.ts";

/** Files prepared at once; the rest queue (the "queues the rest" behaviour). */
export const BULK_UPLOAD_CONCURRENCY = 3;
/** Client-side reject above this; mirrors the server `UPLOAD_MAX_BYTES` (5 GiB)
 *  so an oversized file fails on its row before consuming a dataset slot. */
export const BULK_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
/** Bounded headers read in parallel when files are added, so a big drop doesn't
 *  jank the UI thread. */
const HEADER_PARSE_BATCH = 4;

/** Never sent to the server: a browser-local key for one row of this widget's list. */
const BULK_FILE_KSUID_RESOURCE = "bulkfile";

export type BulkFileStatus =
  | "pending" // accepted, ready to upload
  | "rejected" // unsupported type / too large — never uploaded
  | "queued" // accepted, waiting for an upload slot
  | "uploading" // upload → confirm → create in flight
  | "processing" // created; server is normalizing (poll for ready/failed)
  | "ready"
  | "failed"
  | "cancelled";

export type BulkFile = {
  id: string;
  file: File;
  /** Proposed dataset name (deduped within the batch). */
  name: string;
  /** Parsed header columns; null = header unreadable → columns derived server-side. */
  columns: DatasetConfirmColumns | null;
  /** Confirmed columns (defaults to `columns`); sent to the server's normalize.
   *  Carries each column's immutable `sourceHeader` so the confirm UI can
   *  rename + drag-reorder without breaking the header→column binding. */
  columnTypes: DatasetConfirmColumns | null;
  status: BulkFileStatus;
  datasetId?: string;
  error?: string;
  rejectedReason?: "unsupported" | "too-large";
};

export type BulkUploadCounts = {
  total: number;
  ready: number;
  preparing: number; // uploading + processing
  queued: number;
  failed: number;
};

const isSupportedType = (file: File): boolean => {
  try {
    detectFileFormat(file.name);
    return true;
  } catch {
    return false;
  }
};

/** Parse `files` headers with a small concurrency so a large drop stays smooth. */
const parseHeaders = async (files: File[]): Promise<(DatasetConfirmColumns | null)[]> => {
  const results: (DatasetConfirmColumns | null)[] = Array.from(
    { length: files.length },
    () => null,
  );
  let cursor = 0;
  const lane = async (): Promise<void> => {
    const i = cursor++;
    if (i >= files.length) return;
    try {
      results[i] = await parseHeaderColumns(files[i]!);
    } catch {
      results[i] = null;
    }
    return lane();
  };
  await Promise.all(Array.from({ length: Math.min(HEADER_PARSE_BATCH, files.length) }, lane));
  return results;
};

const errorMessage = (error: unknown): string => {
  if (readHandledError(error)) return describeError({ error });
  return error instanceof Error ? error.message : "Something went wrong preparing this file.";
};

export type BulkUploadTransport = UploadSingleFileDeps & {
  retryDatasetNormalize: (input: RetryNormalizeInput) => Promise<UploadProcessing>;
};

/** A picked file as a row: rejected on its own row when unsupported or too large. */
function bulkFileFor(file: File, columns: BulkFile["columns"]): BulkFile {
  if (!isSupportedType(file)) return makeRejected(file, columns, "unsupported");
  if (file.size > BULK_MAX_UPLOAD_BYTES) return makeRejected(file, columns, "too-large");
  return {
    id: generate(BULK_FILE_KSUID_RESOURCE).toString(),
    file,
    name: baseNameFromFilename(file.name),
    columns,
    columnTypes: columns,
    status: "pending" as const,
  };
}

/** Dedupes names across uploadable rows only; rejected rows never create a dataset. */
function withDedupedNames(merged: BulkFile[]): BulkFile[] {
  const uploadable = merged.filter((f) => f.status !== "rejected");
  const deduped = batchDedupeNames(uploadable.map((f) => f.name));
  let k = 0;
  return merged.map((f) => (f.status === "rejected" ? f : { ...f, name: deduped[k++]! }));
}

/** One file's upload, as the row patch it ends in: processing, cancelled or failed. */
async function uploadedPatch({
  projectId,
  file,
  controller,
  transport,
}: {
  projectId: string;
  file: BulkFile;
  controller: AbortController;
  transport: BulkUploadTransport;
}): Promise<Partial<BulkFile>> {
  try {
    const { datasetId } = await uploadSingleFile(
      {
        projectId,
        name: file.name,
        file: file.file,
        columnTypes: file.columnTypes ?? undefined,
        signal: controller.signal,
        nextName: bumpName,
      },
      transport,
    );
    // Finalized → server is normalizing; the row polls for ready/failed.
    return { status: "processing", datasetId };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return { status: "cancelled" };
    }
    return { status: "failed", error: errorMessage(error) };
  }
}

/** Re-drives normalization of a dataset that already exists; a failure marks the row failed. */
async function renormalizedPatch({
  projectId,
  datasetId,
  transport,
}: {
  projectId: string;
  datasetId: string;
  transport: BulkUploadTransport;
}): Promise<Partial<BulkFile>> {
  try {
    await transport.retryDatasetNormalize({ projectId, datasetId });
    return {};
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
}

function countsOf(files: BulkFile[]): BulkUploadCounts {
  return {
    total: files.length,
    ready: files.filter((f) => f.status === "ready").length,
    preparing: files.filter((f) => f.status === "uploading" || f.status === "processing").length,
    queued: files.filter((f) => f.status === "queued").length,
    failed: files.filter((f) => f.status === "failed" || f.status === "rejected").length,
  };
}

type BulkRowState = {
  setFiles: React.Dispatch<React.SetStateAction<BulkFile[]>>;
  /** The latest rows, for the detached orchestrator and actions to read without stale closures. */
  currentFiles: () => BulkFile[];
  /** One abort controller per in-flight upload; the same map for the hook's lifetime. */
  controllers: Map<string, AbortController>;
  update: (id: string, patch: Partial<BulkFile>) => void;
};

/**
 * Cancel an in-flight (or queued) file; leaves others alone. A `processing` row
 * is already finalized (its dataset exists) and can't be un-created, so it stays.
 */
function cancelBulkFile({
  id,
  controllers,
  currentFiles,
  update,
}: Pick<BulkRowState, "controllers" | "currentFiles" | "update"> & { id: string }): void {
  const controller = controllers.get(id);
  if (controller) {
    controller.abort(); // uploading → abort the PUT; no dataset exists yet
    return;
  }
  const status = currentFiles().find((x) => x.id === id)?.status;
  if (status === "queued" || status === "pending") update(id, { status: "cancelled" });
}

/** Adding, removing, renaming, retyping and cancelling rows. */
function useBulkFileRows({ setFiles, currentFiles, controllers, update }: BulkRowState) {
  /** Add files: reject unsupported/oversized on their own rows, parse headers,
   *  and dedupe names across the WHOLE current list (existing + new). */
  const addFiles = useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0) return;
      const columnsList = await parseHeaders(incoming);
      setFiles((prev) =>
        withDedupedNames([
          ...prev,
          ...incoming.map((file, i) => bulkFileFor(file, columnsList[i] ?? null)),
        ]),
      );
    },
    [setFiles],
  );

  const removeFile = useCallback(
    (id: string) => {
      controllers.get(id)?.abort();
      controllers.delete(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [controllers, setFiles],
  );

  const setColumnTypes = useCallback(
    (id: string, columnTypes: DatasetConfirmColumns) => update(id, { columnTypes }),
    [update],
  );

  /** Rename a not-yet-uploaded file's dataset. Only `pending` rows can be renamed
   *  (once queued/uploading the name is committed server-side); a blank name is
   *  ignored; a within-batch collision is resolved at upload by the 409 bump. */
  const setName = useCallback(
    ({ id, name }: { id: string; name: string }) => {
      const trimmed = name.trim();
      if (trimmed === "") return;
      if (currentFiles().find((f) => f.id === id)?.status !== "pending") return;
      update(id, { name: trimmed });
    },
    [currentFiles, update],
  );

  const cancelFile = useCallback(
    (id: string) => cancelBulkFile({ id, controllers, currentFiles, update }),
    [controllers, currentFiles, update],
  );

  return { addFiles, removeFile, setColumnTypes, setName, cancelFile };
}

/** Running and retrying uploads, each file independent of the others. */
function useBulkUploadRuns({
  projectId,
  transport,
  setFiles,
  currentFiles,
  controllers,
  update,
}: BulkRowState & { projectId: string | undefined; transport: BulkUploadTransport }) {
  /** Run one file's pipeline, updating its status. Never throws (per-file independence). */
  const runOne = useCallback(
    async (id: string) => {
      if (!projectId) return;
      const f = currentFiles().find((x) => x.id === id);
      // Skip rows cancelled/removed while queued: a cancel before their turn
      // must NOT create a dataset.
      if (!f || f.status === "cancelled") return;
      const controller = new AbortController();
      controllers.set(id, controller);
      update(id, { status: "uploading", error: undefined });
      try {
        update(id, await uploadedPatch({ projectId, file: f, controller, transport }));
      } finally {
        controllers.delete(id);
      }
    },
    [controllers, currentFiles, projectId, transport, update],
  );

  /** Start the batch: queue every pending file, then drive the detached pool. */
  const start = useCallback(() => {
    const pending = currentFiles().filter((f) => f.status === "pending");
    if (pending.length === 0) return;
    setFiles((prev) => prev.map((f) => (f.status === "pending" ? { ...f, status: "queued" } : f)));
    // Fire-and-forget (NOT an effect) → survives drawer close.
    void runWithConcurrency(pending, BULK_UPLOAD_CONCURRENCY, (f) => runOne(f.id));
  }, [currentFiles, runOne, setFiles]);

  /** Retry a failed file. A file that already has a dataset re-drives normalize;
   *  one that never created a row re-uploads cleanly (no duplicate dataset). */
  const retryFile = useCallback(
    async (id: string) => {
      const datasetId = currentFiles().find((x) => x.id === id)?.datasetId;
      if (!projectId || !datasetId) return runOne(id);
      update(id, { status: "processing", error: undefined });
      update(id, await renormalizedPatch({ projectId, datasetId, transport }));
    },
    [currentFiles, projectId, runOne, transport, update],
  );

  return { start, retryFile };
}

export function useBulkUpload(projectId: string | undefined, transport: BulkUploadTransport) {
  const [files, setFiles] = useState<BulkFile[]>([]);
  // Mirror state for the detached orchestrator + actions to read without stale
  // closures (the fire-and-forget loop must see the latest rows).
  const filesRef = useRef<BulkFile[]>([]);
  filesRef.current = files;
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const update = useCallback((id: string, patch: Partial<BulkFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const currentFiles = useCallback(() => filesRef.current, []);
  const rowState: BulkRowState = {
    setFiles,
    currentFiles,
    controllers: controllersRef.current,
    update,
  };
  const { addFiles, removeFile, setColumnTypes, setName, cancelFile } = useBulkFileRows(rowState);
  const { start, retryFile } = useBulkUploadRuns({ ...rowState, projectId, transport });

  /** A row's poller reports the terminal server state. */
  const markReady = useCallback((id: string) => update(id, { status: "ready" }), [update]);
  const markFailed = useCallback(
    (id: string, error?: string) => update(id, { status: "failed", error }),
    [update],
  );

  const counts = countsOf(files);

  const hasUploadable = files.some((f) => f.status === "pending");

  return {
    files,
    counts,
    hasUploadable,
    addFiles,
    removeFile,
    setColumnTypes,
    setName,
    start,
    cancelFile,
    retryFile,
    markReady,
    markFailed,
  };
}

const makeRejected = (
  file: File,
  columns: DatasetConfirmColumns | null,
  reason: "unsupported" | "too-large",
): BulkFile => ({
  id: generate(BULK_FILE_KSUID_RESOURCE).toString(),
  file,
  name: baseNameFromFilename(file.name),
  columns,
  columnTypes: columns,
  status: "rejected",
  rejectedReason: reason,
});
