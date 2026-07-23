import { useState } from "react";

import type { OpsBlobSort, OpsBlobSummary } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";

/** One SCAN page per fetch, bounded so a browser never pulls a whole keyspace. */
const PAGE_SIZE = 100;

export interface BlobListing {
  queueNames: string[];
  selectedQueue: string | null;
  setQueueName: (queueName: string) => void;
  sort: OpsBlobSort;
  setSort: (sort: OpsBlobSort) => void;
  blobs: OpsBlobSummary[];
  /** True while ranking saw only a sample of the keyspace, not all of it. */
  rankedFromSample: boolean;
  /** Blobs the current ranking examined; meaningful only when ranked. */
  sampled: number;
  isLoading: boolean;
  /** More SCAN pages remain. Always false for a ranked (single-page) listing. */
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
}

/**
 * Owns everything the payload listing reads: which queue and ordering are
 * selected, and the cursor-paged fetch behind them.
 *
 * Ranked orderings return a single best-of-sample page, so `hasMore` is false
 * for them by construction — only storage order walks the cursor, and that is
 * the one mode where an operator can page past the first {@link PAGE_SIZE}.
 */
export function useBlobListing(): BlobListing {
  const [queueName, setQueueName] = useState<string | null>(null);
  const [sort, setSort] = useState<OpsBlobSort>("largest");

  const queues = api.ops.listBlobQueues.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const selectedQueue = queueName ?? queues.data?.[0] ?? null;

  const blobs = api.ops.listBlobs.useInfiniteQuery(
    { queueName: selectedQueue ?? "", sort, limit: PAGE_SIZE },
    {
      enabled: !!selectedQueue,
      refetchInterval: 30_000,
      keepPreviousData: true,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );

  // The banner and sample count describe the ranking, which lives entirely in
  // the first page; later pages exist only for storage-order paging.
  const firstPage = blobs.data?.pages[0];

  return {
    queueNames: queues.data ?? [],
    selectedQueue,
    setQueueName,
    sort,
    setSort,
    blobs: blobs.data?.pages.flatMap((page) => page.blobs) ?? [],
    rankedFromSample: firstPage?.rankedFromSample ?? false,
    sampled: firstPage?.sampled ?? 0,
    // isInitialLoading, not isLoading: a disabled query (no queue yet) reports
    // "loading" forever, which would pin the spinner before anything is armed.
    isLoading: blobs.isInitialLoading || queues.isLoading,
    hasMore: blobs.hasNextPage ?? false,
    loadMore: () => void blobs.fetchNextPage(),
    isLoadingMore: blobs.isFetchingNextPage,
  };
}
