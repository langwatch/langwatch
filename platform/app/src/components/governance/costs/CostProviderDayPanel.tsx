import { Button, HStack, Text, VStack } from "@chakra-ui/react";
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
 * `Cost over time` beside it: one panel of the breakdown grid. The
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
  //
  // TWO WAYS TO BE SHORT, one note. A bar is missing money either because a
  // cell held no amount at all — `amountUsd === null` — or because a cell was
  // billed in a currency we could not convert, which leaves the bar drawn at a
  // real but incomplete number with nothing null about it. The second kind
  // reads as complete unless it is said, and it is the one a reader can act
  // on, so the currency is named rather than merely counted.
  const partialProviders = partialProviderNotes(rows);

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
      <PartialSpendNote providers={partialProviders} />
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
 * The line under a chart whose bars are short, naming who left them short.
 *
 * Shared by the total chart and the provider split beside it: they are folded
 * from the same rows, so a period short in one is short in the other, and the
 * two panels have to say so in the same words. Renders nothing when no bar is
 * short, so the caller need not guard it.
 */
export function PartialSpendNote({
  providers,
}: {
  /** From `partialProviderNotes`: one phrase per short provider. */
  providers: readonly string[];
}) {
  if (providers.length === 0) return null;
  return (
    <Text
      fontSize="xs"
      color="fg.muted"
      aria-label="Some bars cover only part of what was spent"
    >
      Part of {providers.join(", ")} spend has no dollar figure
    </Text>
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

/**
 * The key every day's total is filed under.
 *
 * A chart of one series still needs a name for it, and "Spend" is what the
 * axis is already measuring — so the legend that would repeat it is turned
 * off at the call site rather than drawn saying nothing.
 */
export const TOTAL_SPEND_KEY = "total";

/**
 * The same rows with the provider dimension collapsed: what was spent, period
 * by period, and nothing about who charged it.
 *
 * Its own panel rather than a reading of the stacked one beside it. A stack
 * answers "which provider caused this period" and a reader has to add its
 * segments by eye to get the total; this answers "is the bill going up",
 * which is the first question anybody asks of a cost screen and the one the
 * stack makes hardest.
 *
 * NO SECOND READ. Both panels are folded from the rows `dailyByProvider`
 * already returned for the screen, so the total here and the stack beside it
 * can never disagree about a period — they are the same numbers added up two
 * ways.
 *
 * IT TAKES THE INTERVAL AND FOLDS, rather than answering days for the caller
 * to fold. The rollup stores days and the screen has no day interval to draw,
 * so unfolded output is never what a caller wants — and a caller that forgot
 * got a bar per day under an axis ticked by quarter, which repeated the
 * quarter's name over each run of three hundred hairline bars and made one
 * heavy day read as the whole quarter. There is now no unfolded value to
 * forget to fold.
 */
export function costTotalBuckets(
  rows: readonly GovernanceCostProviderDayRowDto[],
  interval: TimeInterval,
): CostTotalBucket[] {
  const byDay = new Map<string, number>();
  // Which providers left a period short, keyed by the period's first day —
  // the same fold `aggregateBuckets` applies to the figures, so a mark and
  // the bar it sits on can never disagree about which period they mean.
  const withheldByPeriod = new Map<string, Set<string>>();
  for (const row of rows) {
    // A withheld day adds nothing rather than being guessed at, exactly as it
    // does in the stack — and the bucket SAYS it is short. A bar quietly
    // drawn at the sum of the days that held a figure reads as a cheap
    // period, which is the one thing a withheld figure exists to prevent.
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + (row.amountUsd ?? 0));
    if (row.amountUsd === null) {
      const period = bucketStartOf(row.day, interval);
      const held = withheldByPeriod.get(period) ?? new Set<string>();
      held.add(row.provider);
      withheldByPeriod.set(period, held);
    }
  }
  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({
      day,
      points: [{ key: TOTAL_SPEND_KEY, label: "Spend", value }],
    }));
  return aggregateBuckets(daily, interval).map((bucket) => {
    const withheldProviders = [...(withheldByPeriod.get(bucket.day) ?? [])];
    return {
      ...bucket,
      withheld: withheldProviders.length > 0,
      withheldProviders: withheldProviders.sort(),
    };
  });
}

/**
 * One period of the total chart, carrying whether its bar is the whole figure.
 *
 * `withheld` is true when any row folded into the period holds no dollar
 * figure at all. The bar is then the sum of the days that did, which is SHORT
 * by however much was left out, and the chart draws it as short rather than as
 * a period nobody spent much in. `withheldProviders` names who left it short,
 * sorted, so the note under the chart can say which bill to go and look at.
 */
export type CostTotalBucket = DailyBucket & {
  withheld: boolean;
  withheldProviders: string[];
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
 * One phrase per provider whose bars are short, naming the currency when the
 * shortfall has one.
 *
 * Exported for the same reason the bucket builders above are: it is the whole
 * of a claim the screen makes in prose, and a claim about money is worth
 * testing without a chart in the way.
 *
 * A provider short both ways — some cells with no amount at all, some billed
 * in a currency we could not convert — is listed ONCE, with its currencies. Two
 * entries for one provider would read as two providers, and the reader is being
 * told which names to go and look at.
 */
export function partialProviderNotes(
  rows: readonly GovernanceCostProviderDayRowDto[],
): string[] {
  const currenciesByProvider = new Map<string, Set<string>>();
  for (const row of rows) {
    const short =
      row.amountUsd === null || row.currenciesWithoutUsdAmount.length > 0;
    if (!short) continue;
    const held = currenciesByProvider.get(row.provider) ?? new Set<string>();
    for (const currency of row.currenciesWithoutUsdAmount) held.add(currency);
    currenciesByProvider.set(row.provider, held);
  }
  return [...currenciesByProvider.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, currencies]) => {
      const name = providerName(provider);
      if (currencies.size === 0) return name;
      return `${name} (${[...currencies].sort().join(", ")})`;
    });
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
          <Button
            size="xs"
            variant="outline"
            onClick={() => void records.refetch()}
          >
            Try again
          </Button>
        </HStack>
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
        ))
      )}
    </VStack>
  );
}
