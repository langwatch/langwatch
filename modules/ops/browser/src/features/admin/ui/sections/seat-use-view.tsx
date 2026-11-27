import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Text } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { SEAT_SHARING_WINDOW_DAYS } from "@langwatch/ops-contract";
import { SearchX } from "lucide-react";
import { useState } from "react";
import { useDebounce } from "use-debounce";

import { useAdminList } from "../../behavior/use-admin-resource.ts";
import { useSeatSharingChecks } from "../../behavior/use-seat-sharing-checks.ts";
import {
  SEAT_SHARING_FILTERS,
  flaggedOrganizationIds,
  readingsByOrganization,
  type SeatSharingCheck,
  type SeatSharingFilter,
} from "../../model/seat-sharing.ts";
import { AdminDate, EmptyCell, formatDateTime } from "../elements/admin-cells.tsx";
import { SeatSharingCell } from "../elements/seat-sharing-cell.tsx";
import { AdminTable } from "./admin-table-shell.tsx";

/**
 * Cloud admin's seat use page: every organization beside its people on seats from the
 * last seat sharing check, narrowable to the ones over 2x their seats.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
interface SeatUseOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

const PAGE_SIZE = 25;
const COLUMNS = 6;

export default function SeatUseView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const seatSharing = useSeatSharingChecks();
  const lastCheck = seatSharing.data?.[0];
  const [sharingFilter, setSharingFilter] = useState<SeatSharingFilter>("all");
  const overSeats = sharingFilter === "over";
  const readings = readingsByOrganization(lastCheck);
  const windowDays = lastCheck?.windowDays ?? SEAT_SHARING_WINDOW_DAYS;

  const list = useAdminList<SeatUseOrganization>("organization", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: {
      ...(debouncedSearch ? { query: debouncedSearch } : {}),
      ...(overSeats ? { id: flaggedOrganizationIds(lastCheck) } : {}),
    },
  });

  return (
    <AdminTable
      title="Seat use"
      unitLabel="organizations"
      searchValue={search}
      onSearchChange={(v) => {
        setSearch(v);
        setPage(1);
      }}
      searchPlaceholder="Search by ID, name, or slug"
      summary={
        <SeatSharingSummary
          check={lastCheck}
          isLoading={seatSharing.isLoading}
          failed={seatSharing.isError}
        />
      }
      filters={
        <SegmentedControl
          size="sm"
          aria-label="Seat sharing"
          value={sharingFilter}
          onValueChange={({ value }) => {
            const picked = SEAT_SHARING_FILTERS.find((filter) => filter === value);
            if (!picked) return;
            setSharingFilter(picked);
            setPage(1);
          }}
          items={[
            { value: "all", label: "All organizations" },
            {
              value: "over",
              label: `Over 2x seats (${flaggedOrganizationIds(lastCheck).length})`,
              disabled: !lastCheck,
            },
          ]}
        />
      }
      isLoading={list.isLoading}
      isFetching={list.isFetching}
      error={list.error}
      pagination={{
        page,
        perPage: PAGE_SIZE,
        total: list.data?.total ?? 0,
        onPageChange: setPage,
      }}
    >
      <ListTable density="compact" scroll="x" scrollLabel="Seat use table">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>ID</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Slug</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Plan</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Seat use, {windowDays} days</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Created</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {list.data?.data.length === 0 && (
            <ListTable.SpanRow columns={COLUMNS}>
              <NoDataInfoBlock
                icon={<SearchX />}
                title={
                  overSeats
                    ? "No organization is over 2x its seats."
                    : "No organizations match your search."
                }
                description="Try a different search or clear the filter to see all records."
              />
            </ListTable.SpanRow>
          )}
          {list.data?.data.map((org) => (
            <ListTable.Row key={org.id}>
              <ListTable.IdCell value={org.id} label="organization ID" />
              <ListTable.Cell>{org.name}</ListTable.Cell>
              <ListTable.Cell>
                {org.slug && <InlineCode variant="neutral">{org.slug}</InlineCode>}
              </ListTable.Cell>
              <ListTable.Cell>{readings.get(org.id)?.planName ?? <EmptyCell />}</ListTable.Cell>
              <ListTable.Cell>
                <SeatSharingCell reading={readings.get(org.id)} />
              </ListTable.Cell>
              <ListTable.Cell>
                <AdminDate value={org.createdAt} display="date" />
              </ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </AdminTable>
  );
}

/** When the check last ran and what it flags; it never stops the list from loading. */
function SeatSharingSummary({
  check,
  isLoading,
  failed,
}: {
  check: SeatSharingCheck | undefined;
  isLoading: boolean;
  failed: boolean;
}) {
  const status = seatSharingStatus({ check, isLoading, failed });
  return (
    <Text fontSize="sm" color={failed ? "fg.error" : "fg.muted"}>
      {status} Flagged when distinct people active in the last{" "}
      {check?.windowDays ?? SEAT_SHARING_WINDOW_DAYS} days go over 2x seats. Customers never see
      this.
    </Text>
  );
}

function seatSharingStatus({
  check,
  isLoading,
  failed,
}: {
  check: SeatSharingCheck | undefined;
  isLoading: boolean;
  failed: boolean;
}): string {
  if (failed) return "The seat sharing check could not be loaded.";
  if (isLoading) return "Loading the seat sharing check.";
  if (!check) return "The seat sharing check has not run yet. It runs once a day.";
  return `Seat sharing checked ${formatDateTime(check.checkedAt)}.`;
}
