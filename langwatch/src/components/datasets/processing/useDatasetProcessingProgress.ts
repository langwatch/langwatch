/**
 * ADR-034: live dataset-processing progress hook.
 *
 * Owns the ephemeral side — the per-project SSE subscription (filtered to this
 * datasetId), the latest tick, and the ETA samples. The DURABLE terminal state
 * is owned by the caller's `getById` (passed in as `status`/`statusError`); this
 * hook only nudges it: it calls `onReconcile` on a terminal SSE event and on an
 * SSE gap while still `processing`, so the bar always reaches a definite outcome
 * even if every progress event is dropped (I-TERMINAL-REACHED). Returns a view
 * model, never JSX.
 */
import { useEffect, useRef, useState } from "react";
import {
  DATASET_PROGRESS_STALE_RECONCILE_MS,
  type DatasetProgressEvent,
} from "~/server/datasets/dataset-progress";
import { api } from "~/utils/api";
import {
  type DatasetProgressLive,
  type DatasetProgressView,
  type DatasetStatusLike,
  type EtaSample,
  deriveDatasetProgressView,
  estimateEtaSeconds,
} from "./datasetProgressView";

const MAX_ETA_SAMPLES = 8;

export function useDatasetProcessingProgress(params: {
  projectId: string;
  datasetId: string;
  status: DatasetStatusLike;
  statusError?: string | null;
  /** Refetch the durable `getById` — fired on a terminal SSE event and on a gap. */
  onReconcile?: () => void;
}): DatasetProgressView {
  const { projectId, datasetId, status, statusError, onReconcile } = params;
  const isActive = status === "processing" || status === "uploading";

  const [live, setLive] = useState<DatasetProgressLive | null>(null);
  const samples = useRef<EtaSample[]>([]);
  const lastEventAt = useRef<number>(Date.now());
  const reconcileRef = useRef(onReconcile);
  reconcileRef.current = onReconcile;

  api.dataset.onDatasetProgress.useSubscription(
    { projectId },
    {
      enabled: isActive && !!projectId,
      onData: (event: DatasetProgressEvent) => {
        // One project-wide subscription multiplexes every dataset; ignore ticks
        // for datasets this mount isn't watching.
        if (event.datasetId !== datasetId) return;
        lastEventAt.current = Date.now();
        if (event.type === "progress") {
          setLive({
            bytesRead: event.bytesRead,
            totalBytes: event.totalBytes,
            rows: event.rows,
            phase: event.phase,
          });
          if (event.bytesRead != null) {
            samples.current = [
              ...samples.current,
              { t: Date.now(), bytes: event.bytesRead },
            ].slice(-MAX_ETA_SAMPLES);
          }
        } else {
          // done | error: pull the durable terminal status now.
          reconcileRef.current?.();
        }
      },
    },
  );

  // Gap safety: still `processing` but no tick for a while → reconcile via
  // getById (catches a dropped terminal event or a dead worker).
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      if (
        Date.now() - lastEventAt.current >
        DATASET_PROGRESS_STALE_RECONCILE_MS
      ) {
        reconcileRef.current?.();
      }
    }, DATASET_PROGRESS_STALE_RECONCILE_MS);
    return () => clearInterval(id);
  }, [isActive]);

  // Clear ephemeral state once the dataset settles so a later re-entry is clean.
  useEffect(() => {
    if (!isActive) {
      setLive(null);
      samples.current = [];
    }
  }, [isActive]);

  const etaSeconds = estimateEtaSeconds(
    samples.current,
    live?.totalBytes,
    live?.bytesRead,
  );

  return deriveDatasetProgressView({ status, statusError, live, etaSeconds });
}
