/**
 * ADR-034: the bulk-drawer companion to {@link useDatasetProcessingProgress}.
 *
 * The bulk drawer can have many datasets preparing at once. Mounting the
 * single-dataset hook per row would open N subscriptions against the per-tenant
 * emitter and hit its 50-listener ceiling (the per-dataset trap the ADR rejects
 * in Decision 3). Instead the drawer mounts THIS once: a single project-wide
 * subscription accumulating the latest live tick per datasetId, which rows read
 * presentationally. Terminal state stays each row's own `getById` poll (the
 * durable authority), so a dropped progress event never strands a row.
 */
import { useState } from "react";
import type { DatasetProgressEvent } from "~/server/datasets/dataset-progress";
import { api } from "~/utils/api";
import type { DatasetProgressLive } from "./datasetProgressView";

export function useDatasetProgressMap({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}): Record<string, DatasetProgressLive> {
  const [map, setMap] = useState<Record<string, DatasetProgressLive>>({});

  api.dataset.onDatasetProgress.useSubscription(
    { projectId },
    {
      enabled: enabled && !!projectId,
      onData: (event: DatasetProgressEvent) => {
        // On terminal (done/error) drop the cached tick so a later retry of the
        // same datasetId starts from an honest indeterminate state rather than
        // reusing a stale percent until the first fresh tick arrives.
        if (event.type !== "progress") {
          setMap((prev) => {
            if (!(event.datasetId in prev)) return prev;
            const next = { ...prev };
            delete next[event.datasetId];
            return next;
          });
          return;
        }
        setMap((prev) => ({
          ...prev,
          [event.datasetId]: {
            bytesRead: event.bytesRead,
            totalBytes: event.totalBytes,
            rows: event.rows,
            phase: event.phase,
          },
        }));
      },
    },
  );

  return map;
}
