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
        // Only live ticks update the map; terminal done/error is reconciled by
        // each row's getById poll, so the last live tick can stay until then.
        if (event.type !== "progress") return;
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
