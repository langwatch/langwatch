import { Drawer } from "@langwatch/design-system/drawer";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { IdText } from "@langwatch/design-system/id-text";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Pagination } from "@langwatch/design-system/pagination";
import { Stack, Text } from "@langwatch/design-system/primitives";
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
    <ListTable.Row tone={row.deadMessages > 0 ? "danger" : void 0} onActivate={() => onOpen(row)}>
      {showProcess && (
        <ListTable.Cell nowrap>
          <InlineCode variant="neutral">{row.processName}</InlineCode>
        </ListTable.Cell>
      )}
      <ListTable.Cell nowrap title={row.processKey}>
        <ListTable.RowAction onActivate={() => onOpen(row)}>
          {middleEllipsis(row.processKey, 44)}
        </ListTable.RowAction>
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        <IdText value={row.projectId} label="ID" />
      </ListTable.Cell>
      <ListTable.Cell nowrap numeric>
        <Text textStyle="caption" fontVariantNumeric="tabular-nums">
          {row.revision}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        <Text
          textStyle="xs"
          color={wakeOverdue ? "fg.warning" : "fg.muted"}
          fontWeight={wakeOverdue ? "medium" : undefined}
        >
          {describeNextWake(row.nextWakeAt, now)}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        <Text textStyle="xs" color="fg.muted">
          <FormattedDate value={row.updatedAt} display="relative" />
        </Text>
      </ListTable.Cell>
      <ListTable.Cell nowrap numeric>
        <Text textStyle="caption" fontVariantNumeric="tabular-nums">
          {row.pendingMessages}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell nowrap numeric>
        <Text
          textStyle="caption"
          fontVariantNumeric="tabular-nums"
          color={row.deadMessages > 0 ? "red.fg" : "fg.muted"}
        >
          {row.deadMessages}
        </Text>
      </ListTable.Cell>
    </ListTable.Row>
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
    <ListTable density="compact" scroll="x" scrollLabel="Process instances table">
      <ListTable.Header>
        <ListTable.Row>
          {showProcess && <ListTable.ColumnHeader>Process</ListTable.ColumnHeader>}
          <ListTable.ColumnHeader>Process key</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Project</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Revision</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Next wake</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Updated</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Pending</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Dead</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => (
          <InstanceRow
            key={`${row.processName}:${row.projectId}:${row.processKey}`}
            row={row}
            now={now}
            showProcess={showProcess}
            onOpen={onOpen}
          />
        ))}
      </ListTable.Body>
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
    <Drawer
      onClose={onClose}
      size="xl"
      eyebrow={{ label: "Processes" }}
      title="Process instances"
      subtitle={allProcesses ? "All processes" : processName}
      footer={
        query.isError
          ? void 0
          : {
              summary: (
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  totalCount={total}
                  visibleCount={rows.length}
                  unitLabel="instances"
                  isLoading={query.isPending}
                  onPageChange={setPage}
                />
              ),
            }
      }
    >
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
          <InstancesBody
            isPending={query.isPending}
            rows={rows}
            searching={!!search.trim()}
            now={now}
            showProcess={allProcesses}
            onOpen={(row) => onOpenInstance(row)}
          />
        )}
      </Stack>
    </Drawer>
  );
}
