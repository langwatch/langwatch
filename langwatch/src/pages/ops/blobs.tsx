import {
  Badge,
  Box,
  Button,
  Center,
  EmptyState,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { Database, MoreVertical } from "lucide-react";
import { useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";

const SORTS = [
  { value: "largest", label: "Largest first" },
  { value: "unreferenced", label: "Nothing referencing them" },
  { value: "stalest", label: "Longest untouched" },
  { value: "oldest_lapsed_lease", label: "Longest since a holder stopped" },
  { value: "scan", label: "Storage order" },
] as const;

/** Verdict a sweep would reach, phrased for a reader rather than for the script. */
const OUTCOME_LABEL: Record<string, { label: string; palette: string }> = {
  leased: { label: "In use", palette: "green" },
  repaired: { label: "Will shorten", palette: "orange" },
  reclaimed: { label: "Will delete", palette: "red" },
  bookkeeping: { label: "Leftover keys", palette: "gray" },
  pending: { label: "Expiring", palette: "yellow" },
  unknown: { label: "Unknown", palette: "gray" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "No expiry";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatLapsed(deadlineMs: number | null): string {
  if (deadlineMs === null) return "None";
  const delta = Date.now() - deadlineMs;
  if (delta <= 0) return "Live";
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function OpsBlobsPage() {
  const { hasAccess } = useOpsPermission();
  const [queueName, setQueueName] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("largest");
  const [deleteTarget, setDeleteTarget] = useState<{
    projectId: string;
    hash: string;
  } | null>(null);
  const [reclaimConfirm, setReclaimConfirm] = useState<string | null>(null);

  const utils = api.useContext();
  const queues = api.ops.listBlobQueues.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const selectedQueue = queueName ?? queues.data?.[0] ?? null;

  const blobs = api.ops.listBlobs.useQuery(
    { queueName: selectedQueue ?? "", sort, limit: 100 },
    { enabled: !!selectedQueue, refetchInterval: 30_000 },
  );

  const cleanup = api.ops.runBlobCleanup.useMutation({
    onSuccess: (report) => {
      toaster.create({
        title: report.dryRun
          ? `Preview: ${report.totals.reclaimed} would be deleted`
          : `Reclaimed ${report.totals.reclaimed}, shortened ${report.totals.repaired}`,
        type: "success",
      });
      setReclaimConfirm(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      toaster.create({
        title: "Cleanup failed",
        description: error.message,
        type: "error",
      });
    },
  });

  const deleteBlob = api.ops.deleteBlob.useMutation({
    onSuccess: (result) => {
      toaster.create({
        title: result.deleted
          ? "Payload deleted"
          : "Not deleted, something still references it",
        type: result.deleted ? "success" : "warning",
      });
      setDeleteTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      toaster.create({
        title: "Delete failed",
        description: error.message,
        type: "error",
      });
    },
  });

  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Payload store</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <Text textStyle="sm" color="fg.muted" marginBottom={4}>
            Stored job payloads, what still references them, and what the next
            cleanup would do with each. Payload contents are never shown.
          </Text>

          <HStack marginBottom={4} gap={3}>
            <NativeSelect.Root size="sm" width="260px">
              <NativeSelect.Field
                value={selectedQueue ?? ""}
                onChange={(e) => setQueueName(e.currentTarget.value)}
              >
                {queues.data?.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>

            <NativeSelect.Root size="sm" width="280px">
              <NativeSelect.Field
                value={sort}
                onChange={(e) =>
                  setSort(
                    e.currentTarget.value as (typeof SORTS)[number]["value"],
                  )
                }
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>

            <Spacer />

            {hasAccess && (
              <>
                <Button
                  size="2xs"
                  variant="outline"
                  loading={cleanup.isPending && cleanup.variables?.dryRun}
                  onClick={() => cleanup.mutate({ dryRun: true })}
                >
                  Preview cleanup
                </Button>
                <Button
                  size="2xs"
                  variant="outline"
                  colorPalette="red"
                  onClick={() => setReclaimConfirm("")}
                >
                  Run cleanup
                </Button>
              </>
            )}
          </HStack>

          {blobs.data?.rankedFromSample && (
            <Text textStyle="xs" color="fg.muted" marginBottom={3}>
              Ordered from a sample of {blobs.data.sampled} payloads, not the
              whole store. Use storage order to walk everything.
            </Text>
          )}

          {blobs.isLoading || queues.isLoading ? (
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
          ) : (blobs.data?.blobs.length ?? 0) === 0 ? (
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
            <Box overflowX="auto">
              <Table.Root variant="line" size="sm">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Project</Table.ColumnHeader>
                    <Table.ColumnHeader>Payload</Table.ColumnHeader>
                    <Table.ColumnHeader>Size</Table.ColumnHeader>
                    <Table.ColumnHeader>Expires in</Table.ColumnHeader>
                    <Table.ColumnHeader>Referenced by</Table.ColumnHeader>
                    <Table.ColumnHeader>Holder stopped</Table.ColumnHeader>
                    <Table.ColumnHeader>Next cleanup</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {blobs.data?.blobs.map((blob) => {
                    const outcome =
                      OUTCOME_LABEL[blob.sweepOutcome] ?? OUTCOME_LABEL.unknown!;
                    return (
                      <Table.Row key={`${blob.projectId}/${blob.hash}`}>
                        <Table.Cell>
                          <Text textStyle="xs" fontFamily="mono">
                            {blob.projectId}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text textStyle="xs" fontFamily="mono">
                            {blob.hash}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>{formatBytes(blob.sizeBytes)}</Table.Cell>
                        <Table.Cell>
                          {formatDuration(blob.ttlSeconds)}
                        </Table.Cell>
                        <Table.Cell>
                          {blob.liveLeases > 0 ? (
                            <Badge colorPalette="green" variant="subtle">
                              {blob.liveLeases} job
                              {blob.liveLeases === 1 ? "" : "s"}
                            </Badge>
                          ) : (
                            <Badge colorPalette="gray" variant="subtle">
                              Nothing
                            </Badge>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Text textStyle="xs" color="fg.muted">
                            {formatLapsed(blob.earliestLeaseDeadlineMs)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge
                            colorPalette={outcome.palette}
                            variant="subtle"
                          >
                            {outcome.label}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          {hasAccess && (
                            <Menu.Root>
                              <Menu.Trigger asChild>
                                <Button
                                  variant="ghost"
                                  size="2xs"
                                  aria-label={`Actions for payload ${blob.hash}`}
                                >
                                  <MoreVertical size={14} />
                                </Button>
                              </Menu.Trigger>
                              <Menu.Content>
                                <Menu.Item
                                  value="delete"
                                  color="red.500"
                                  onClick={() =>
                                    setDeleteTarget({
                                      projectId: blob.projectId,
                                      hash: blob.hash,
                                    })
                                  }
                                >
                                  Delete payload
                                </Menu.Item>
                              </Menu.Content>
                            </Menu.Root>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Box>
          )}

          <ConfirmDialog
            open={!!deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => {
              if (!deleteTarget || !selectedQueue) return;
              deleteBlob.mutate({
                queueName: selectedQueue,
                projectId: deleteTarget.projectId,
                hash: deleteTarget.hash,
                confirm: "DELETE",
              });
            }}
            title="Delete this payload"
            description="The job that referenced it will finish without running. This cannot be undone, and it will be refused if anything still references it."
            isLoading={deleteBlob.isPending}
          />

          <ConfirmDialog
            open={reclaimConfirm !== null}
            onClose={() => setReclaimConfirm(null)}
            onConfirm={() => {
              if (reclaimConfirm !== "RECLAIM") return;
              cleanup.mutate({ dryRun: false, confirm: "RECLAIM" });
            }}
            title="Run cleanup"
            description="Payloads nothing references will be deleted. Type RECLAIM to confirm."
            isLoading={cleanup.isPending}
            confirmDisabled={reclaimConfirm !== "RECLAIM"}
          >
            <Input
              size="sm"
              placeholder="RECLAIM"
              value={reclaimConfirm ?? ""}
              onChange={(e) => setReclaimConfirm(e.currentTarget.value)}
            />
          </ConfirmDialog>
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
