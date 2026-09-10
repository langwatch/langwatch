import { HStack, Text, VStack } from "@chakra-ui/react";
import type { GovernanceCostProviderDayRowDto } from "@ee/governance/services/governanceCost.service";
import { useMemo, useState } from "react";

import type { TimeInterval } from "~/components/governance/filters";
import { api } from "~/utils/api";

import { formatLaneUsd } from "../costLaneFormat";
import { CostStackedBars, formatDayTick } from "./CostCharts";
import { providerName } from "./CostProviderBreakdown";
import { aggregateBuckets, bucketStartOf } from "./costsWindow";
import type { DailyBucket } from "./sampleSeries";

/**
 * The window split by the provider that charged for it, over time.
 *
 * The screen could already say what a provider cost over a quarter, and what
 * the organization spent in total. It could not say which provider caused a
 * period that stood out, which is the first question anybody asks of a period
 * that stood out — so the answer took a spreadsheet and two exports.
 *
 * THE PERIOD IS THE UNIT, not the day. The read answers in days, because days
 * are what the rollup stores, but the screen has no day interval to offer: its
 * Time Interval chip carries month, quarter and year and nothing narrower. An
 * earlier version of this panel drew one control per day per provider anyway,
 * which over the default window — a year, read by quarter — laid out several
 * hundred identical little boxes in a wrapped wall, in the order the days fell
 * rather than the order that would answer anything. Every figure on it was
 * correct and the panel was unreadable.
 *
 * It is a chart and its legend and nothing else, sized and placed exactly like
 * `Cost over time · by team` beside it: one panel of the breakdown grid. The
 * wall's replacement was briefly a shorter wall — a row of period buttons
 * under the bars — and a row of controls under a chart is a shape nothing else
 * on this screen has. What those buttons did instead belongs on the bars, which
 * is where a reader was already pointing.
 */
export function CostProviderDayPanel({
  organizationId,
  rows,
  interval,
}: {
  organizationId: string;
  /** One figure per (day, provider). Empty renders nothing. */
  rows: readonly GovernanceCostProviderDayRowDto[];
  /** The bucket width the reader chose, which the periods here follow. */
  interval: TimeInterval;
}) {
  const [opened, setOpened] = useState<{
    period: string;
    provider: string;
  } | null>(null);

  const buckets = useMemo(
    () => aggregateBuckets(providerDayBuckets(rows), interval),
    [rows, interval],
  );
  const periods = useMemo(
    () => providerPeriods(rows, interval),
    [rows, interval],
  );

  if (rows.length === 0) return null;

  // A provider whose window total was withheld still has periods that each
  // hold a real number, so a reader who adds the bars up rebuilds exactly the
  // partial sum the total refused to show them. Saying so under the chart is
  // what stops the bars from BEING that sum.
  const partialProviders = [
    ...new Set(
      rows.filter((row) => row.amountUsd === null).map((row) => row.provider),
    ),
  ].sort();

  const openedPeriod =
    opened === null
      ? null
      : (periods.find(
          (period) =>
            period.provider === opened.provider &&
            period.period === opened.period,
        ) ?? null);

  return (
    <VStack
      align="stretch"
      gap={2}
      width="full"
      // NOT "Cost by provider": the billed lane card already owns that
      // name for its own per-provider list, and two regions answering to
      // one name is a reader landing on whichever the tree reaches first.
      aria-label="Cost over time · by provider"
    >
      <CostStackedBars
        buckets={buckets}
        interval={interval}
        onSelectSeries={(provider, period) => setOpened({ provider, period })}
      />
      {partialProviders.length > 0 && (
        <Text
          fontSize="xs"
          color="fg.muted"
          aria-label="Some bars cover only part of what was spent"
        >
          Part of {partialProviders.map(providerName).join(", ")} spend has no
          dollar figure
        </Text>
      )}
      {openedPeriod && (
        <PeriodRecords
          organizationId={organizationId}
          period={openedPeriod}
          interval={interval}
        />
      )}
    </VStack>
  );
}

/**
 * One (period, provider) figure: the days it covers, and what they came to.
 *
 * `fromDay` and `toDay` are the FIRST AND LAST DAY THAT ACTUALLY CARRIED A ROW
 * inside the period, not the calendar bounds of the period itself. The two
 * differ for the period the window opens or closes on, and the rows are what
 * the bar was drawn from — so taking the range from them is what keeps the
 * records under a bar equal to the bar, including on a quarter the window only
 * caught three weeks of.
 */
export type ProviderPeriod = {
  provider: string;
  /** The period's first day as the fold names it, used as its identity. */
  period: string;
  fromDay: string;
  toDay: string;
  /** The sum of the days that held a figure. See `partial`. */
  amountUsd: number;
  /** Whether some day inside this period held no dollar figure at all. */
  partial: boolean;
};

/** The rows as one stackable bucket per day, one series per provider. */
export function providerDayBuckets(
  rows: readonly GovernanceCostProviderDayRowDto[],
): DailyBucket[] {
  const byDay = new Map<string, DailyBucket>();
  for (const row of rows) {
    let bucket = byDay.get(row.day);
    if (!bucket) {
      bucket = { day: row.day, points: [] };
      byDay.set(row.day, bucket);
    }
    // A withheld day contributes nothing to the height rather than being
    // guessed at. The line under the chart is what says the height is short.
    bucket.points.push({
      key: row.provider,
      label: providerName(row.provider),
      value: row.amountUsd ?? 0,
    });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The same rows folded to one entry per (period, provider). */
export function providerPeriods(
  rows: readonly GovernanceCostProviderDayRowDto[],
  interval: TimeInterval,
): ProviderPeriod[] {
  const byKey = new Map<string, ProviderPeriod>();
  for (const row of rows) {
    const period = bucketStartOf(row.day, interval);
    const key = `${row.provider} ${period}`;
    const held = byKey.get(key);
    if (!held) {
      byKey.set(key, {
        provider: row.provider,
        period,
        fromDay: row.day,
        toDay: row.day,
        amountUsd: row.amountUsd ?? 0,
        partial: row.amountUsd === null,
      });
      continue;
    }
    if (row.day < held.fromDay) held.fromDay = row.day;
    if (row.day > held.toDay) held.toDay = row.day;
    held.amountUsd += row.amountUsd ?? 0;
    held.partial = held.partial || row.amountUsd === null;
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) || a.period.localeCompare(b.period),
  );
}

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
function PeriodRecords({
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
        {providerName(period.provider)} ·{" "}
        {formatDayTick(period.period, interval)} ·{" "}
        {formatLaneUsd(period.amountUsd)}
      </Text>
      {/*
        A failed read and a read still in flight both leave `rows` null, and
        the screen this panel opens inside holds that the two must never look
        alike: an empty answer is a finding, a failed read is something to try
        again. So the failure is asked about first.
      */}
      {records.isError ? (
        <Text fontSize="sm" color="fg.muted">
          This period could not be read. Refresh to try again.
        </Text>
      ) : rows === null ? (
        <Text fontSize="sm" color="fg.muted">
          Reading what this period was made of.
        </Text>
      ) : rows.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          This period holds no records at this provider.
        </Text>
      ) : (
        rows.map((record) => (
          <HStack key={record.label} justify="space-between" gap={3}>
            <Text fontSize="sm">{record.label}</Text>
            <Text fontSize="sm" fontVariantNumeric="tabular-nums">
              {formatLaneUsd(record.amountUsd)}
            </Text>
          </HStack>
        ))
      )}
    </VStack>
  );
}
