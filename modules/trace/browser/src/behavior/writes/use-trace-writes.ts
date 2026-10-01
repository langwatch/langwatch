import { datasetClient } from "@langwatch/dataset-client";

import { api } from "../trace-api.ts";

/**
 * Everything that lists queues or counts their work: the listing, the queue
 * page, the pickers, the sidebar and its badges.
 */
function useInvalidateQueueReads() {
  const utils = api.useUtils();
  return () => {
    void utils.annotation.getOptimizedAnnotationQueues.invalidate();
    void utils.annotation.getQueueBySlugOrId.invalidate();
    void utils.annotation.getQueues.invalidate();
    void utils.annotation.getQueueItemsCounts.invalidate();
    void utils.annotation.getPendingItemsCount.invalidate();
    void utils.annotation.getAssignedItemsCount.invalidate();
  };
}

export function useCreateOrUpdateAnnotationQueue() {
  const invalidateQueueReads = useInvalidateQueueReads();
  return api.annotation.createOrUpdateQueue.useMutation({ onSuccess: invalidateQueueReads });
}

/** The sidebar badges and the queue listing count pending work, so items landing stales them. */
function useInvalidateQueueCounts() {
  const utils = api.useUtils();
  return () => {
    void utils.annotation.getPendingItemsCount.invalidate();
    void utils.annotation.getAssignedItemsCount.invalidate();
    void utils.annotation.getQueueItemsCounts.invalidate();
    void utils.annotation.getOptimizedAnnotationQueues.invalidate();
  };
}

export function useCreateQueueItem({
  onSuccess,
  onError,
}: {
  onSuccess: (result: { created: number; skipped: number }) => void;
  onError: (error: unknown) => void;
}) {
  const invalidateQueueCounts = useInvalidateQueueCounts();
  return api.annotation.createQueueItem.useMutation({
    onSuccess: (result) => {
      invalidateQueueCounts();
      onSuccess(result);
    },
    onError,
  });
}

export function useInvalidateDatasets() {
  const utils = datasetClient.useUtils();
  return () => void utils.dataset.getAll.invalidate();
}

export function useCreateDatasetRecord() {
  const utils = datasetClient.useUtils();
  return datasetClient.datasetRecord.create.useMutation({
    onSuccess: () => {
      void utils.dataset.getAll.invalidate();
      void utils.datasetRecord.getAll.invalidate();
    },
  });
}

export function useUpdateDatasetMapping() {
  const utils = datasetClient.useUtils();
  return datasetClient.dataset.updateMapping.useMutation({
    onSuccess: () => void utils.dataset.getAll.invalidate(),
  });
}

export function useCancelInstantEval() {
  const utils = api.useUtils();
  return api.traces.instantEval.cancel.useMutation({
    onSuccess: () => void utils.traces.instantEval.get.invalidate(),
  });
}

export function useTracePinRead({
  projectId,
  traceId,
}: {
  projectId: string | undefined;
  traceId: string;
}) {
  return api.pinnedTrace.getPin.useQuery(
    { projectId: projectId ?? "", traceId },
    { enabled: !!projectId },
  );
}

export function usePinTrace() {
  const utils = api.useUtils();
  return api.pinnedTrace.pin.useMutation({
    onSuccess: () => void utils.pinnedTrace.getPin.invalidate(),
  });
}

export function useUnpinTrace() {
  const utils = api.useUtils();
  return api.pinnedTrace.unpin.useMutation({
    onSuccess: () => void utils.pinnedTrace.getPin.invalidate(),
  });
}

export function useUpsertTraceEdit() {
  const utils = api.useUtils();
  return api.traceEditOverlay.upsert.useMutation({
    onSuccess: () => void utils.traceEditOverlay.getByTraceId.invalidate(),
  });
}

/** The save must build on what is stored now, so this read never answers from the cache. */
export function useFetchStoredTraceEdit() {
  const utils = api.useUtils();
  return ({ projectId, traceId }: { projectId: string; traceId: string }) =>
    utils.traceEditOverlay.getByTraceId.fetch({ projectId, traceId }, { staleTime: 0 });
}
