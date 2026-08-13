import {
  Box,
  Button,
  Card,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { middleEllipsis } from "~/components/ops/queues/clusterGroups";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { useDrawer } from "~/hooks/useDrawer";
import type { ProcessInstanceRow } from "~/server/app-layer/ops/repositories/process-ops.repository";
import { api } from "~/utils/api";
import { describeNextWake } from "./processFleet";

const PAGE_SIZE = 25;

function InstanceRow({
  row,
  now,
  onOpen,
}: {
  row: ProcessInstanceRow;
  now: number;
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
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono" title={row.processKey}>
          {middleEllipsis(row.processKey, 44)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text
          textStyle="xs"
          color="fg.muted"
          fontFamily="mono"
          title={row.projectId}
        >
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
  onOpen,
}: {
  rows: ProcessInstanceRow[];
  now: number;
  onOpen: (row: ProcessInstanceRow) => void;
}) {
  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
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
            key={`${row.projectId}:${row.processKey}`}
            row={row}
            now={now}
            onOpen={onOpen}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function InstancesBody({
  isPending,
  rows,
  searching,
  now,
  onOpen,
}: {
  isPending: boolean;
  rows: ProcessInstanceRow[];
  searching: boolean;
  now: number;
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
  return <InstancesTable rows={rows} now={now} onOpen={onOpen} />;
}

/** The selected process name's instances, searchable by process key. */
export function ProcessInstancesCard({ processName }: { processName: string }) {
  const { openDrawer } = useDrawer();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const query = api.ops.listProcessInstances.useQuery(
    {
      processName,
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

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack
          paddingX={4}
          paddingY={2.5}
          borderBottom="1px solid"
          borderBottomColor="border"
          gap={2}
        >
          <Text textStyle="sm" fontWeight="medium">
            Instances
          </Text>
          <Text textStyle="xs" color="fg.muted" fontFamily="mono">
            {processName}
          </Text>
          <Spacer />
          <Input
            size="xs"
            width="220px"
            placeholder="Search by process key..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {pageCount > 1 && (
            <HStack gap={1}>
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
          onOpen={(row) =>
            openDrawer("opsProcessInstance", {
              processName: row.processName,
              projectId: row.projectId,
              processKey: row.processKey,
            })
          }
        />
      </Card.Body>
    </Card.Root>
  );
}
