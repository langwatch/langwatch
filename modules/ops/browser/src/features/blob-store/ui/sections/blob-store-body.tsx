import { LoadMore } from "@langwatch/design-system/load-more";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { OpsBlobSummary } from "@langwatch/ops-contract";
import { Database } from "lucide-react";

import { BlobTable } from "../blocks/blob-table.tsx";

export function BlobStoreBody({
  isLoading,
  blobs,
  canManage,
  onDelete,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: {
  isLoading: boolean;
  blobs: OpsBlobSummary[];
  canManage: boolean;
  onDelete: (blob: OpsBlobSummary) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}) {
  if (isLoading) {
    return <SkeletonRows rows={6} />;
  }

  if (blobs.length === 0) {
    return (
      <NoDataInfoBlock
        icon={<Database />}
        title="No stored payloads"
        description="Nothing is being held for this queue."
      />
    );
  }

  return (
    <>
      <BlobTable blobs={blobs} canManage={canManage} onDelete={onDelete} />
      <LoadMore hasMore={hasMore} loading={isLoadingMore} onLoadMore={onLoadMore} />
    </>
  );
}
