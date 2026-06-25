/**
 * Bulk upload (D3 React wrapper, + D5/D7/D8 wiring): owns the per-file rows and
 * drives the orchestration core.
 *
 * The orchestrator is fire-and-forget — `start()` kicks `runWithConcurrency` as a
 * detached promise chain, NOT a React effect — so closing the drawer (unmounting
 * the hook) does not abort in-flight or queued files: they keep preparing and
 * surface in the datasets list (the "close keeps preparing" behaviour). Status
 * setters that fire after unmount are harmless no-ops.
 */
import { nanoid } from "nanoid";
import { useCallback, useRef, useState } from "react";
import type { DatasetColumns } from "~/server/datasets/types";
import { detectFileFormat } from "~/server/datasets/upload-utils";
import { retryDatasetNormalize } from "../services/directUpload";
import { parseHeaderColumns } from "../utils/parseHeaderColumns";
import {
  baseNameFromFilename,
  batchDedupeNames,
  bumpName,
} from "./batchNameDedup";
import { runWithConcurrency, uploadSingleFile } from "./bulkUploadOrchestrator";

/** Files prepared at once; the rest queue (the "queues the rest" behaviour). */
export const BULK_UPLOAD_CONCURRENCY = 3;
/** Client-side reject above this; mirrors the server `UPLOAD_MAX_BYTES` (5 GiB)
 *  so an oversized file fails on its row before consuming a dataset slot. */
export const BULK_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
/** Bounded headers read in parallel when files are added, so a big drop doesn't
 *  jank the UI thread. */
const HEADER_PARSE_BATCH = 4;

export type BulkFileStatus =
  | "pending" // accepted, ready to upload
  | "rejected" // unsupported type / too large — never uploaded
  | "queued" // accepted, waiting for an upload slot
  | "uploading" // requestDirectUpload → PUT → finalize in flight
  | "processing" // finalized; server is normalizing (poll for ready/failed)
  | "ready"
  | "failed"
  | "cancelled";

export type BulkFile = {
  id: string;
  file: File;
  /** Proposed dataset name (deduped within the batch). */
  name: string;
  /** Parsed header columns; null = header unreadable → columns derived server-side. */
  columns: DatasetColumns | null;
  /** Confirmed columns (defaults to `columns`); sent to the server's normalize. */
  columnTypes: DatasetColumns | null;
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
const parseHeaders = async (
  files: File[],
): Promise<(DatasetColumns | null)[]> => {
  const results: (DatasetColumns | null)[] = new Array(files.length).fill(null);
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
  await Promise.all(
    Array.from({ length: Math.min(HEADER_PARSE_BATCH, files.length) }, lane),
  );
  return results;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Something went wrong preparing this file.";

export function useBulkUpload(projectId: string | undefined) {
  const [files, setFiles] = useState<BulkFile[]>([]);
  // Mirror state for the detached orchestrator + actions to read without stale
  // closures (the fire-and-forget loop must see the latest rows).
  const filesRef = useRef<BulkFile[]>([]);
  filesRef.current = files;
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const update = useCallback((id: string, patch: Partial<BulkFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  /** Add files: reject unsupported/oversized on their own rows, parse headers,
   *  and dedupe names across the WHOLE current list (existing + new). */
  const addFiles = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) return;
    const columnsList = await parseHeaders(incoming);
    setFiles((prev) => {
      const additions: BulkFile[] = incoming.map((file, i) => {
        const columns = columnsList[i] ?? null;
        if (!isSupportedType(file)) {
          return makeRejected(file, columns, "unsupported");
        }
        if (file.size > BULK_MAX_UPLOAD_BYTES) {
          return makeRejected(file, columns, "too-large");
        }
        return {
          id: nanoid(),
          file,
          name: baseNameFromFilename(file.name),
          columns,
          columnTypes: columns,
          status: "pending" as const,
        };
      });
      // Dedupe names across uploadable rows only (rejected rows never create).
      const merged = [...prev, ...additions];
      const uploadable = merged.filter((f) => f.status !== "rejected");
      const deduped = batchDedupeNames(uploadable.map((f) => f.name));
      let k = 0;
      return merged.map((f) =>
        f.status === "rejected" ? f : { ...f, name: deduped[k++]! },
      );
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
    controllersRef.current.delete(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const setColumnTypes = useCallback(
    (id: string, columnTypes: DatasetColumns) => update(id, { columnTypes }),
    [update],
  );

  /** Run one file's pipeline, updating its status. Never throws (per-file
   *  independence). */
  const runOne = useCallback(
    async (id: string) => {
      if (!projectId) return;
      const f = filesRef.current.find((x) => x.id === id);
      // Skip rows cancelled/removed while queued — runWithConcurrency captured
      // them at start(), but a cancel before their turn must NOT create a
      // dataset. (Status may still read "pending" here if the queue re-render
      // hasn't flushed; only an explicit cancel/removal blocks the run.)
      if (!f || f.status === "cancelled") return;
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      update(id, { status: "uploading", error: undefined });
      try {
        const { datasetId } = await uploadSingleFile({
          projectId,
          name: f.name,
          file: f.file,
          columnTypes: f.columnTypes ?? undefined,
          signal: controller.signal,
          nextName: bumpName,
        });
        // Finalized → server is normalizing; the row polls for ready/failed.
        update(id, { status: "processing", datasetId });
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          update(id, { status: "cancelled" });
        } else {
          update(id, { status: "failed", error: errorMessage(error) });
        }
      } finally {
        controllersRef.current.delete(id);
      }
    },
    [projectId, update],
  );

  /** Start the batch: queue every pending file, then drive the detached pool. */
  const start = useCallback(() => {
    const pending = filesRef.current.filter((f) => f.status === "pending");
    if (pending.length === 0) return;
    setFiles((prev) =>
      prev.map((f) =>
        f.status === "pending" ? { ...f, status: "queued" } : f,
      ),
    );
    // Fire-and-forget (NOT an effect) → survives drawer close.
    void runWithConcurrency(pending, BULK_UPLOAD_CONCURRENCY, (f) =>
      runOne(f.id),
    );
  }, [runOne]);

  /** Cancel an in-flight (or queued) file; reaps its row, leaves others alone. */
  const cancelFile = useCallback(
    (id: string) => {
      const controller = controllersRef.current.get(id);
      if (controller) {
        controller.abort(); // uploading → abort the PUT; runOne reaps the row
        return;
      }
      // No in-flight PUT: only a not-yet-started row can be cancelled. A
      // `processing` row is already finalized (its dataset exists) and can't be
      // un-created here, so leave it.
      const f = filesRef.current.find((x) => x.id === id);
      if (f && (f.status === "queued" || f.status === "pending")) {
        update(id, { status: "cancelled" });
      }
    },
    [update],
  );

  /** Retry a failed file. Two modes (no duplicate dataset): if it already has a
   *  dataset (finalized but preparation failed) re-drive normalize; otherwise it
   *  never created a row (reaped on failure) so re-upload cleanly. */
  const retryFile = useCallback(
    async (id: string) => {
      if (!projectId) return;
      const f = filesRef.current.find((x) => x.id === id);
      if (!f) return;
      if (f.datasetId) {
        update(id, { status: "processing", error: undefined });
        try {
          await retryDatasetNormalize({ projectId, datasetId: f.datasetId });
        } catch (error) {
          update(id, { status: "failed", error: errorMessage(error) });
        }
        return;
      }
      await runOne(id);
    },
    [projectId, runOne, update],
  );

  /** A row's poller reports the terminal server state. */
  const markReady = useCallback(
    (id: string) => update(id, { status: "ready" }),
    [update],
  );
  const markFailed = useCallback(
    (id: string, error?: string) => update(id, { status: "failed", error }),
    [update],
  );

  const counts: BulkUploadCounts = {
    total: files.length,
    ready: files.filter((f) => f.status === "ready").length,
    preparing: files.filter(
      (f) => f.status === "uploading" || f.status === "processing",
    ).length,
    queued: files.filter((f) => f.status === "queued").length,
    failed: files.filter(
      (f) => f.status === "failed" || f.status === "rejected",
    ).length,
  };

  const hasUploadable = files.some((f) => f.status === "pending");

  return {
    files,
    counts,
    hasUploadable,
    addFiles,
    removeFile,
    setColumnTypes,
    start,
    cancelFile,
    retryFile,
    markReady,
    markFailed,
  };
}

const makeRejected = (
  file: File,
  columns: DatasetColumns | null,
  reason: "unsupported" | "too-large",
): BulkFile => ({
  id: nanoid(),
  file,
  name: baseNameFromFilename(file.name),
  columns,
  columnTypes: columns,
  status: "rejected",
  rejectedReason: reason,
});
