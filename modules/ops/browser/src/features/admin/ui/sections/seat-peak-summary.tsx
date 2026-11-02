/**
 * Our team's view of the most seats an organization held at once each month, beside what its
 * licence sells (ADR-002). Renewal reads it here; the customer's own pages never show it.
 */
import { Table, Text, VStack } from "@langwatch/design-system/primitives";
import type { OrganizationSeatPeakMonth } from "@langwatch/organization-contract";

import { api } from "../../../../behavior/ops-api.ts";
import { formatDateUtc, formatSeatCap, SectionHeading } from "../elements/admin-cells.tsx";

export function SeatPeakSummary({ organizationId }: { organizationId: string }) {
  return (
    <VStack align="stretch" gap={2}>
      <SectionHeading>Seats</SectionHeading>
      <SeatPeakBody organizationId={organizationId} />
    </VStack>
  );
}

function SeatPeakBody({ organizationId }: { organizationId: string }) {
  const peak = api.organizationSeatPeak.get.useQuery({ organizationId });

  if (peak.isLoading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading seats…
      </Text>
    );
  }
  if (!peak.data) {
    return (
      <Text fontSize="sm" color="fg.error">
        The seat peak could not be loaded.
      </Text>
    );
  }
  if (!peak.data.counted) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="ops-seat-peak-not-counted">
        Seat counting has not started for this organization
      </Text>
    );
  }

  const [thisMonth, ...earlier] = peak.data.months;
  const { seats, caps } = peak.data;
  return (
    <VStack align="stretch" gap={2} data-testid="ops-seat-peak">
      <Text fontSize="sm">
        Full seats: {seats.full} of {formatSeatCap(caps.fullSeats)} in use
        {thisMonth
          ? `, peak this month ${thisMonth.fullPeak} (${formatDateUtc(thisMonth.fullPeakAt)})`
          : ""}
      </Text>
      <Text fontSize="sm">
        Lite Member seats: {seats.lite} of {formatSeatCap(caps.liteSeats)} in use
        {thisMonth
          ? `, peak this month ${thisMonth.litePeak} (${formatDateUtc(thisMonth.litePeakAt)})`
          : ""}
      </Text>
      {earlier.length > 0 && <EarlierMonths months={earlier} />}
      {peak.data.mismatches > 0 && (
        <Text fontSize="sm" color="fg.muted" data-testid="ops-seat-peak-mismatches">
          {peak.data.mismatches} seat {peak.data.mismatches === 1 ? "change" : "changes"} disagreed
          with the count
        </Text>
      )}
    </VStack>
  );
}

function EarlierMonths({ months }: { months: readonly OrganizationSeatPeakMonth[] }) {
  return (
    <Table.Root size="sm" aria-label="Seat peaks of earlier months">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Month</Table.ColumnHeader>
          <Table.ColumnHeader>Full seat peak</Table.ColumnHeader>
          <Table.ColumnHeader>Lite Member seat peak</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {months.map((month) => (
          <Table.Row key={month.month}>
            <Table.Cell>{month.month}</Table.Cell>
            <Table.Cell>
              {month.fullPeak} ({formatDateUtc(month.fullPeakAt)})
            </Table.Cell>
            <Table.Cell>
              {month.litePeak} ({formatDateUtc(month.litePeakAt)})
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
