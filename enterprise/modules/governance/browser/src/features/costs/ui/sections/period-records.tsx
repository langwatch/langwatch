// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { GovernanceCostDayRecord } from "@langwatch/enterprise-governance-contract";

import { api } from "../../../../behavior/governance-api.ts";
import { formatDayTick } from "../../model/cost-figure-format.ts";
import { formatLaneUsd } from "../../model/cost-lane-format.ts";
import { type ProviderPeriod } from "../../model/provider-day-buckets.ts";
import { providerName } from "../../model/provider-name.ts";
import { type TimeInterval } from "../../model/time-controls.ts";

/**
 * What one period at one provider was made of: what each record was for, and
 * what it cost.
 *
 * Mounted only once a reader opens a period, so the read is issued when it is
 * asked for rather than on every page load. This screen is read while a
 * decision is being made, so it never re-reads on its own — the rule is stated
 * here at the call site rather than inherited, exactly as the reads above it
 * state it.
 */
export function PeriodRecords({
  organizationId,
  period,
  interval,
}: {
  organizationId: string;
  period: ProviderPeriod;
  interval: TimeInterval;
}) {
  const records = api.governanceCost.periodRecords.useQuery(
    {
      organizationId,
      fromDay: period.fromDay,
      toDay: period.toDay,
      provider: period.provider,
    },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const rows = records.data?.records ?? null;

  return (
    <VStack
      align="stretch"
      gap={1}
      aria-label="Records behind this period"
      borderTopWidth="1px"
      borderColor="border.subtle"
      paddingTop={2}
    >
      <Text fontSize="xs" color="fg.muted">
        {providerName(period.provider)} · {formatDayTick(period.period, interval)} ·{" "}
        {formatLaneUsd(period.amountUsd)}
      </Text>
      {/*
        A failed read and a read still in flight both leave `rows` null, and
        the screen this panel opens inside holds that the two must never look
        alike: an empty answer is a finding, a failed read is something to try
        again. So the failure is asked about first.
      */}
      <PeriodRecordsBody
        isError={records.isError}
        rows={rows}
        onRetry={() => void records.refetch()}
      />
    </VStack>
  );
}

/** The records list, or why it is not there yet: a failure is asked about first. */
function PeriodRecordsBody({
  isError,
  rows,
  onRetry,
}: {
  isError: boolean;
  rows: readonly GovernanceCostDayRecord[] | null;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <HStack gap={2}>
        <Text fontSize="sm" color="fg.muted">
          This period could not be read.
        </Text>
        {/*
            A CONTROL, not the word "refresh". The screen's own refresh
            deliberately leaves this read out — the records behind a period are
            absent until a reader opens one, and refetching a query nobody
            opened is work with no reader — so the sentence that told them to
            refresh was pointing at a button that would not have retried this.
            The only way back was to close the period and open it again, which
            works by accident and reads as giving up.

            Local on purpose: the retry belongs where the failure is, and the
            read it repeats is this component's own.
          */}
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </HStack>
    );
  }
  if (rows === null) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Reading what this period was made of.
      </Text>
    );
  }
  if (rows.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        This period holds no records at this provider.
      </Text>
    );
  }
  return (
    <>
      {rows.map((record) => (
        <HStack key={record.label} justify="space-between" gap={3}>
          <Text fontSize="sm">{record.label}</Text>
          <HStack gap={2}>
            {/*
                The same mark the bar above this list carries, at the row it
                belongs to rather than over the whole period. A reader opens a
                period to find out WHICH charge made the figure short; a note
                repeated at the top would send them back to guessing.
              */}
            {record.currenciesWithoutUsdAmount.length > 0 && (
              <Text fontSize="xs" color="fg.muted">
                + {record.currenciesWithoutUsdAmount.join(", ")} not converted
              </Text>
            )}
            <Text fontSize="sm" fontVariantNumeric="tabular-nums">
              {formatLaneUsd(record.amountUsd)}
            </Text>
          </HStack>
        </HStack>
      ))}
    </>
  );
}
