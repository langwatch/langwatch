// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { VStack } from "@chakra-ui/react";
import { type GovernanceCostProviderDayRow } from "@langwatch/enterprise-governance-contract";
import { useMemo, useState } from "react";

import { providerSplitBuckets } from "../../model/provider-day-buckets.ts";
import { partialProviderNotes, providerPeriods } from "../../model/provider-periods.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostStackedBars } from "../blocks/cost-stacked-bars.tsx";
import { PartialSpendNote } from "../blocks/partial-spend-note.tsx";
import { PeriodRecords } from "./period-records.tsx";

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
  rows: readonly GovernanceCostProviderDayRow[];
  /** The bucket width the reader chose, which the periods here follow. */
  interval: TimeInterval;
}) {
  const [opened, setOpened] = useState<{
    period: string;
    provider: string;
  } | null>(null);

  const buckets = useMemo(() => providerSplitBuckets(rows, interval), [rows, interval]);
  const periods = useMemo(() => providerPeriods(rows, interval), [rows, interval]);
  // A provider whose window total was withheld still has periods that each
  // hold a real number, so a reader who adds the bars up rebuilds exactly the
  // partial sum the total refused to show them. Saying so under the chart is
  // what stops the bars from BEING that sum.
  //
  // Read off the buckets the chart draws, not off the rows again: the bars
  // and the note under them are then two readings of one fold, and a period
  // the chart marks short is a period the note names. See `rowIsShort` for
  // the two ways a period gets short.
  const partialProviders = useMemo(() => partialProviderNotes(buckets), [buckets]);

  if (rows.length === 0) return null;

  const openedPeriod =
    opened === null
      ? null
      : (periods.find(
          (period) => period.provider === opened.provider && period.period === opened.period,
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
        <PeriodRecords organizationId={organizationId} period={openedPeriod} interval={interval} />
      )}
    </VStack>
  );
}
