import { Text } from "@chakra-ui/react";
import { useState } from "react";

import { useOpsPermission } from "~/hooks/useOpsPermission";
import type { OpsBlobSummary } from "~/server/app-layer/ops/types";

import { BlobStoreBody } from "./BlobStoreBody";
import { BlobToolbar } from "./BlobToolbar";
import { DeletePayloadDialog } from "./DeletePayloadDialog";
import { RunCleanupDialog } from "./RunCleanupDialog";
import { useBlobListing } from "./useBlobListing";
import { useBlobStoreActions } from "./useBlobStoreActions";

export function BlobStoreContent() {
  const { hasAccess } = useOpsPermission();
  const listing = useBlobListing();
  const [deleteTarget, setDeleteTarget] = useState<OpsBlobSummary | null>(null);
  const [reclaimConfirm, setReclaimConfirm] = useState<string | null>(null);

  const { cleanup, deleteBlob } = useBlobStoreActions({
    // Only the destructive run owns the prompt; a resolving preview must not
    // close a Run dialog the operator opened in the meantime.
    onCleanupSuccess: (variables) => {
      if (variables.dryRun === false) setReclaimConfirm(null);
    },
    // Close only if the resolved delete is the one still on screen — the blob
    // is identified by all three key parts, so a delete in another queue with
    // the same project + hash cannot close this queue's dialog.
    onDeleteSuccess: (variables) => {
      setDeleteTarget((current) =>
        current?.queueName === variables.queueName &&
        current?.projectId === variables.projectId &&
        current?.hash === variables.hash
          ? null
          : current,
      );
    },
  });

  return (
    <>
      <Text textStyle="sm" color="fg.muted" marginBottom={4}>
        Stored job payloads, what still references them, and what the next
        cleanup would do with each. Payload contents are never shown.
      </Text>

      <BlobToolbar
        queueNames={listing.queueNames}
        selectedQueue={listing.selectedQueue}
        onQueueChange={listing.setQueueName}
        sort={listing.sort}
        onSortChange={listing.setSort}
        canManage={hasAccess}
        onPreviewCleanup={() => cleanup.mutate({ dryRun: true })}
        onRunCleanup={() => setReclaimConfirm("")}
        previewLoading={cleanup.isPending && cleanup.variables?.dryRun === true}
      />

      {listing.rankedFromSample && (
        <Text textStyle="xs" color="fg.muted" marginBottom={3}>
          Ordered from a sample of {listing.sampled} payloads, not the whole
          store. Use storage order to walk everything.
        </Text>
      )}

      <BlobStoreBody
        isLoading={listing.isLoading}
        blobs={listing.blobs}
        canManage={hasAccess}
        onDelete={setDeleteTarget}
        hasMore={listing.hasMore}
        onLoadMore={listing.loadMore}
        isLoadingMore={listing.isLoadingMore}
      />

      <DeletePayloadDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(blob) =>
          deleteBlob.mutate({
            queueName: blob.queueName,
            projectId: blob.projectId,
            hash: blob.hash,
            confirm: "DELETE",
          })
        }
        isLoading={deleteBlob.isPending}
      />

      <RunCleanupDialog
        value={reclaimConfirm}
        onChange={setReclaimConfirm}
        onClose={() => setReclaimConfirm(null)}
        onConfirm={() => cleanup.mutate({ dryRun: false, confirm: "RECLAIM" })}
        isLoading={cleanup.isPending}
      />
    </>
  );
}
