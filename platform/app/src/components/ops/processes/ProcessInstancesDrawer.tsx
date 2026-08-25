import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { middleEllipsis } from "~/components/ops/queues/clusterGroups";
import { formatTimeAgo } from "@langwatch/ops-web";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
import type { ProcessInstanceRow } from "~/server/app-layer/ops/repositories/process-ops.repository";
import { api } from "~/utils/api";
import { describeNextWake } from "./processFleet";

const PAGE_SIZE = 25;

function InstanceRow({
  row,
  now,
  showProcess,
  onOpen,
}: {
  row: ProcessInstanceRow;
  now: number;
  showProcess: boolean;
  onOpen: (row: ProcessInstanceRow) => void;
}) {
  const wakeOverdue = row.nextWakeAt !== null && row.nextWakeAt < now;
  return (
    <Table.Row
      cursor="pointer"
      bg={row.deadMessages > 0 ? "red.subtle" : undefined}
      _hover={{ bg: "bg.subtle" }}
      onClick={() => onOpen(row)}
    >
      {showProcess && (
        <Table.Cell>
          <Text textStyle="xs" fontFamily="mono">
            {row.processName}
          </Text>
        </Table.Cell>
      )}
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono" title={row.processKey}>
          {middleEllipsis(row.processKey, 44)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted" fontFamily="mono" title={row.projectId}>
          {middleEllipsis(row.projectId, 24)}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.revision}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text
          textStyle="xs"
          color={wakeOverdue ? "orange.500" : "fg.muted"}
          fontWeight={wakeOverdue ? "medium" : undefined}
        >
          {describeNextWake(row.nextWakeAt, now)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {formatTimeAgo(row.updatedAt, now)}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.pendingMessages}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text
          textStyle="xs"
          fontFamily="mono"
          color={row.deadMessages > 0 ? "red.500" : "fg.muted"}
        >
          {row.deadMessages}
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

function InstancesTable({
  rows,
  now,
  showProcess,
  onOpen,
}: {
  rows: ProcessInstanceRow[];
  now: number;
  showProcess: boolean;
  onOpen: (row: ProcessInstanceRow) => void;
}) {
  return (
    <Table.ScrollArea>
      <Table.Root size="sm" variant="line">
        <Table.Header>
          <Table.Row>
            {showProcess && <Table.ColumnHeader>Process</Table.ColumnHeader>}
            <Table.ColumnHeader>Process key</Table.ColumnHeader>
            <Table.ColumnHeader>Project</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Revision</Table.ColumnHeader>
            <Table.ColumnHeader>Next wake</Table.ColumnHeader>
            <Table.ColumnHeader>Updated</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Pending</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Dead</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <InstanceRow
              key={`${row.processName}:${row.projectId}:${row.processKey}`}
              row={row}
              now={now}
              showProcess={showProcess}
              onOpen={onOpen}
            />
          ))}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}

function InstancesBody({
  isPending,
  rows,
  searching,
  now,
  showProcess,
  onOpen,
}: {
  isPending: boolean;
  rows: ProcessInstanceRow[];
  searching: boolean;
  now: number;
  showProcess: boolean;
  onOpen: (row: ProcessInstanceRow) => void;
}) {
  if (isPending) {
    return (
      <Box padding={4}>
        <Spinner size="sm" />
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box padding={4}>
        <Text textStyle="xs" color="fg.muted">
          {searching
            ? "No instances match the search."
            : "No instances yet for this process."}
        </Text>
      </Box>
    );
  }
  return (
    <InstancesTable rows={rows} now={now} showProcess={showProcess} onOpen={onOpen} />
  );
}

interface Props {
  /** Omit for the all-processes view. */
  processName?: string;
}

/**
 * URL-routed drawer listing process-manager instances — one process's when
 * opened from a fleet row, or every process's when opened without a name.
 * Clicking an instance swaps to its detail drawer.
 */
export function ProcessInstancesDrawer({ processName }: Props) {
  const { openDrawer, closeDrawer } = useDrawer();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const query = api.ops.listProcessInstances.useQuery(
    {
      processName: processName || undefined,
      page,
      pageSize: PAGE_SIZE,
      search: search.trim() || undefined,
    },
    { refetchInterval: 15_000 },
  );
  const now = query.dataUpdatedAt || Date.now();
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = query.data?.instances ?? [];
  const allProcesses = !processName;

  return (
    <Drawer.Root open={true} placement="end" size="xl" onOpenChange={() => closeDrawer()}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack gap={2} width="full">
            <Heading size="md">Process instances</Heading>
            {allProcesses ? (
              <Badge size="sm" variant="subtle" colorPalette="gray">
                all processes
              </Badge>
            ) : (
              <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                {processName}
              </Text>
            )}
            <Spacer />
            <Text textStyle="xs" color="fg.muted">
              {total} total
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <HStack gap={2} marginBottom={3}>
            <Input
              size="xs"
              width="260px"
              placeholder="Search by process key..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <Spacer />
            {pageCount > 1 && (
              <HStack gap={1}>
                <Text textStyle="xs" color="fg.muted">
                  Page {page} of {pageCount}
                </Text>
                <Button
                  size="2xs"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="2xs"
                  variant="outline"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </HStack>
            )}
          </HStack>
          <InstancesBody
            isPending={query.isPending}
            rows={rows}
            searching={!!search.trim()}
            now={now}
            showProcess={allProcesses}
            onOpen={(row) =>
              openDrawer("opsProcessInstance", {
                processName: row.processName,
                projectId: row.projectId,
                processKey: row.processKey,
              })
            }
          />
        </Drawer.Body>
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
