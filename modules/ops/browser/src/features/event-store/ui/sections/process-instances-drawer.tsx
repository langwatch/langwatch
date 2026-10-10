import { DetailDrawerHeader } from "@langwatch/design-system/detail-drawer-header";
import { Drawer } from "@langwatch/design-system/drawer";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Pagination } from "@langwatch/design-system/pagination";
import { Box, Button, Stack, Table, Text } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { ProcessInstanceRow } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";
import { Layers } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { middleEllipsis } from "../../../../model/queue-cluster-groups.ts";
import { describeNextWake } from "../../model/process-presentation.ts";

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
        <Button
          variant="plain"
          size="xs"
          title={row.processKey}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
        >
          {middleEllipsis(row.processKey, 44)}
        </Button>
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
          color={wakeOverdue ? "fg.warning" : "fg.muted"}
          fontWeight={wakeOverdue ? "medium" : undefined}
        >
          {describeNextWake(row.nextWakeAt, now)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          <FormattedDate value={row.updatedAt} display="relative" />
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.pendingMessages}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono" color={row.deadMessages > 0 ? "red.fg" : "fg.muted"}>
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
    <ListTable
      density="compact"
      columnRules={false}
      whiteSpace="nowrap"
      containerProps={{ overflowX: "auto" }}
    >
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
    </ListTable>
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
    return <ListPageSkeleton label="Loading process instances" />;
  }
  if (rows.length === 0) {
    return (
      <NoDataInfoBlock
        icon={<Layers />}
        title={searching ? "No instances match the search." : "No instances yet for this process."}
        description={
          searching
            ? "Try a different process key."
            : "Instances appear when this process receives work."
        }
      />
    );
  }
  return <InstancesTable rows={rows} now={now} showProcess={showProcess} onOpen={onOpen} />;
}

interface Props {
  /** Omit for the all-processes view. */
  processName?: string;
  onClose: () => void;
  /** Opens one instance's detail. The caller owns both addresses. */
  onOpenInstance: (row: ProcessInstanceRow) => void;
}

/**
 * URL-routed drawer listing process-manager instances — one process's when
 * opened from a fleet row, or every process's when opened without a name.
 * Clicking an instance swaps to its detail drawer.
 */
export function ProcessInstancesDrawer({ processName, onClose, onOpenInstance }: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const query = api.ops.listProcessInstances.useQuery(
    {
      processName: processName || undefined,
      page,
      pageSize: PAGE_SIZE,
      search: search.trim() || undefined,
    },
    {},
  );
  const now = query.dataUpdatedAt || nowInstant().epochMilliseconds;
  const total = query.data?.total ?? 0;
  const rows = query.data?.instances ?? [];
  const allProcesses = !processName;

  return (
    <Drawer.Root open={true} placement="end" size="xl" onOpenChange={() => onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <DetailDrawerHeader kind="Processes" title="Process instances">
            <Text textStyle="sm" color="fg.muted">
              {allProcesses ? "All processes" : processName}
            </Text>
          </DetailDrawerHeader>
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap={4}>
            <SearchInput
              aria-label="Search process instances"
              placeholder="Search by process key..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {query.isError ? (
              <HandledErrorAlert
                error={query.error}
                fallbackTitle="The process instances could not load"
              />
            ) : (
              <>
                <InstancesBody
                  isPending={query.isPending}
                  rows={rows}
                  searching={!!search.trim()}
                  now={now}
                  showProcess={allProcesses}
                  onOpen={(row) => onOpenInstance(row)}
                />
              </>
            )}
          </Stack>
        </Drawer.Body>
        <Drawer.Footer>
          <Box width="full">
            {!query.isError && (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                totalCount={total}
                visibleCount={rows.length}
                unitLabel="instances"
                isLoading={query.isPending}
                onPageChange={setPage}
              />
            )}
          </Box>
        </Drawer.Footer>
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
