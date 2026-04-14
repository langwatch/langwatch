import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
} from "@chakra-ui/react";
import { toaster } from "~/components/ui/toaster";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";

export function DlqCard({ queueNames }: { queueNames: string[] }) {
  const { canManage } = useOpsPermission();
  const utils = api.useContext();

  const dlqQuery = api.ops.listAllDlqGroups.useQuery(undefined, { refetchInterval: 10000 });

  const [replayTarget, setReplayTarget] = useState<{ queueName: string; groupId: string } | null>(null);
  const [replayAllTarget, setReplayAllTarget] = useState<string | null>(null);
  const [canaryTarget, setCanaryTarget] = useState<string | null>(null);
  const [canaryCount, setCanaryCount] = useState(5);

  const replayMutation = api.ops.replayFromDlq.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Replayed ${data.jobsReplayed} jobs`, type: "success" }); setReplayTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Replay failed", description: error.message, type: "error" }); },
  });
  const replayAllMutation = api.ops.replayAllFromDlq.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Replayed ${data.replayedCount} groups`, type: "success" }); setReplayAllTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Replay all failed", description: error.message, type: "error" }); },
  });
  const canaryRedriveMutation = api.ops.canaryRedrive.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Canary redrove ${data.redrivenCount}`, type: "success" }); setCanaryTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Canary failed", description: error.message, type: "error" }); },
  });

  const groups = dlqQuery.data ?? [];
  const dlqQueueNames = [...new Set(groups.map((g) => g.queueName))];

  if (dlqQuery.isLoading || groups.length === 0) return null;

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border" gap={2} flexWrap="wrap">
            <Text textStyle="sm" fontWeight="medium" color="orange.500">
              Dead Letter Queue — {groups.length} group{groups.length !== 1 ? "s" : ""}
            </Text>
            <Spacer />
            {canManage && (
              <HStack gap={1.5} flexWrap="wrap">
                {dlqQueueNames.map((qn) => {
                  const count = groups.filter((g) => g.queueName === qn).length;
                  const displayName = groups.find((g) => g.queueName === qn)?.queueDisplayName ?? qn;
                  return (
                    <Button key={qn} variant="outline" size="2xs" colorPalette="green" onClick={() => setReplayAllTarget(qn)}>
                      Replay All {displayName} ({count})
                    </Button>
                  );
                })}
                <HStack gap={1}>
                  <Text textStyle="xs" color="fg.muted">Canary:</Text>
                  <Input size="xs" type="number" value={canaryCount} onChange={(e) => setCanaryCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 5)))} width="50px" />
                  {dlqQueueNames.map((qn) => (
                    <Button key={`c-${qn}`} variant="ghost" size="2xs" onClick={() => setCanaryTarget(qn)}>Go</Button>
                  ))}
                </HStack>
              </HStack>
            )}
          </HStack>

          <Table.ScrollArea>
            <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Queue</Table.ColumnHeader>
                  <Table.ColumnHeader>Group ID</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end" width="50px">Jobs</Table.ColumnHeader>
                  {canManage && <Table.ColumnHeader width="70px">Actions</Table.ColumnHeader>}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {groups.map((group) => (
                  <Table.Row key={`${group.queueName}:${group.groupId}`}>
                    <Table.Cell><Badge size="xs" variant="subtle">{group.queueDisplayName}</Badge></Table.Cell>
                    <Table.Cell><Text textStyle="xs" fontFamily="mono" truncate maxWidth="160px">{group.groupId}</Text></Table.Cell>
                    <Table.Cell><Text textStyle="xs" color="fg.muted">{group.pipelineName ?? "\u2014"}</Text></Table.Cell>
                    <Table.Cell><Text textStyle="xs" color="red.500" truncate maxWidth="220px" title={group.error ?? undefined}>{group.error ?? ""}</Text></Table.Cell>
                    <Table.Cell textAlign="end"><Text textStyle="xs">{group.jobCount}</Text></Table.Cell>
                    {canManage && (
                      <Table.Cell>
                        <Button variant="outline" size="2xs" colorPalette="green" onClick={() => setReplayTarget({ queueName: group.queueName, groupId: group.groupId })}>Replay</Button>
                      </Table.Cell>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </Card.Body>
      </Card.Root>

      <ConfirmDialog open={!!replayTarget} onClose={() => setReplayTarget(null)} onConfirm={() => { if (replayTarget) replayMutation.mutate(replayTarget); }} title="Replay from DLQ" description={`Move "${replayTarget?.groupId}" back to main queue for reprocessing.`} isLoading={replayMutation.isPending} />
      <ConfirmDialog open={!!replayAllTarget} onClose={() => setReplayAllTarget(null)} onConfirm={() => { if (replayAllTarget) replayAllMutation.mutate({ queueName: replayAllTarget }); }} title="Replay All from DLQ" description={`Move all DLQ groups in "${replayAllTarget}" back to main queue.`} isLoading={replayAllMutation.isPending} />
      <ConfirmDialog open={!!canaryTarget} onClose={() => setCanaryTarget(null)} onConfirm={() => { if (canaryTarget) canaryRedriveMutation.mutate({ queueName: canaryTarget, count: canaryCount }); }} title="Canary Redrive" description={`Replay ${canaryCount} random DLQ groups from "${canaryTarget}" as canary.`} isLoading={canaryRedriveMutation.isPending} />
    </>
  );
}
