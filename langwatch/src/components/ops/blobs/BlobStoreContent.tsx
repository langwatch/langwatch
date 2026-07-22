import { Center, EmptyState, Spinner, Text } from "@chakra-ui/react";
import { Database } from "lucide-react";
import { useState } from "react";

import { useOpsPermission } from "~/hooks/useOpsPermission";
import type {
  OpsBlobSort,
  OpsBlobSummary,
} from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";

import { BlobTable } from "./BlobTable";
import { BlobToolbar } from "./BlobToolbar";
import { DeletePayloadDialog } from "./DeletePayloadDialog";
import { RunCleanupDialog } from "./RunCleanupDialog";
import { useBlobStoreActions } from "./useBlobStoreActions";

const PAGE_SIZE = 100;

export function BlobStoreContent() {
  const { hasAccess } = useOpsPermission();
  const [queueName, setQueueName] = useState<string | null>(null);
  const [sort, setSort] = useState<OpsBlobSort>("largest");
  const [deleteTarget, setDeleteTarget] = useState<OpsBlobSummary | null>(null);
  const [reclaimConfirm, setReclaimConfirm] = useState<string | null>(null);

  const queues = api.ops.listBlobQueues.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const selectedQueue = queueName ?? queues.data?.[0] ?? null;

  const blobs = api.ops.listBlobs.useQuery(
    { queueName: selectedQueue ?? "", sort, limit: PAGE_SIZE },
    { enabled: !!selectedQueue, refetchInterval: 30_000 },
  );

  const { cleanup, deleteBlob } = useBlobStoreActions({
    onCleanupSuccess: () => setReclaimConfirm(null),
    onDeleteSuccess: () => setDeleteTarget(null),
  });

  const isLoading = blobs.isLoading || queues.isLoading;
  const rows = blobs.data?.blobs ?? [];

  return (
    <>
      <Text textStyle="sm" color="fg.muted" marginBottom={4}>
        Stored job payloads, what still references them, and what the next
        cleanup would do with each. Payload contents are never shown.
      </Text>

      <BlobToolbar
        queueNames={queues.data ?? []}
        selectedQueue={selectedQueue}
        onQueueChange={setQueueName}
        sort={sort}
        onSortChange={setSort}
        canManage={hasAccess}
        onPreviewCleanup={() => cleanup.mutate({ dryRun: true })}
        onRunCleanup={() => setReclaimConfirm("")}
        previewLoading={cleanup.isPending && cleanup.variables?.dryRun === true}
      />

      {blobs.data?.rankedFromSample && (
        <Text textStyle="xs" color="fg.muted" marginBottom={3}>
          Ordered from a sample of {blobs.data.sampled} payloads, not the whole
          store. Use storage order to walk everything.
        </Text>
      )}

      {isLoading ? (
        <Center paddingY={20}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Spinner size="lg" />
              </EmptyState.Indicator>
              <EmptyState.Title>Loading payloads</EmptyState.Title>
            </EmptyState.Content>
          </EmptyState.Root>
        </Center>
      ) : rows.length === 0 ? (
        <Center paddingY={20}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Database />
              </EmptyState.Indicator>
              <EmptyState.Title>No stored payloads</EmptyState.Title>
              <EmptyState.Description>
                Nothing is being held for this queue.
              </EmptyState.Description>
            </EmptyState.Content>
          </EmptyState.Root>
        </Center>
      ) : (
        <BlobTable
          blobs={rows}
          canManage={hasAccess}
          onDelete={setDeleteTarget}
        />
      )}

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
