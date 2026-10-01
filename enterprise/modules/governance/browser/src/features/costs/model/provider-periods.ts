// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type GovernanceCostProviderDayRow } from "@langwatch/enterprise-governance-contract";

import { bucketStartOf } from "./costs-window.ts";
import { type ProviderPeriod } from "./provider-day-buckets.ts";
import { providerName } from "./provider-name.ts";
import { type DailyBucket } from "./sample-series.ts";
import { type TimeInterval } from "./time-controls.ts";

/**
 * Whether a row's figure is not the whole of what was spent that day.
 *
 * THE ONE DEFINITION OF SHORT. There are two ways a day gets short: a cell
 * held no amount at all, so `amountUsd` is null, or a cell was billed in a
 * currency we could not convert, which leaves `amountUsd` a real but
 * incomplete number with nothing null about it. Each fold on this screen used
 * to spell the rule out for itself, and two of them spelled out only the
 * first half — so a day billed in dollars and euros drew a whole bar over a
 * note saying part of its spend had no dollar figure. Every fold asks here
 * now, and a bar, a period and the note under them cannot disagree.
 */
export function rowIsShort(
  row: Pick<GovernanceCostProviderDayRow, "amountUsd" | "currenciesWithoutUsdAmount">,
): boolean {
  return row.amountUsd === null || row.currenciesWithoutUsdAmount.length > 0;
}

/**
 * One provider that left a period short, and the currencies its shortfall
 * was billed in when it has any. Empty currencies means a cell with no amount
 * at all.
 */
export type ProviderShortfall = {
  provider: string;
  /** Sorted. */
  currencies: string[];
};

/**
 * One period of a cost chart, carrying whether its bar is the whole figure.
 *
 * `withheld` is true when any row folded into the period is short (see
 * `rowIsShort`). The bar is then the sum of the figures we do hold, which is
 * SHORT by however much was left out, and the chart draws it as short rather
 * than as a period nobody spent much in. `withheldProviders` names who left it
 * short, sorted by provider, and is what the note under the chart is built
 * from — so the note names exactly the providers whose bars are marked.
 */
export type WithheldBucket = DailyBucket & {
  withheld: boolean;
  withheldProviders: ProviderShortfall[];
};

/**
 * Attach to each folded period whether the rows behind it left it short, and
 * who did. Keyed by the period's first day — the same fold `aggregateBuckets`
 * applies to the figures, so a mark and the bar it sits on can never disagree
 * about which period they mean.
 *
 * Shared by the total chart and the provider split beside it on purpose:
 * one fold, two charts, no way for a period to be short in one and whole in
 * the other.
 */
export function markWithheldPeriods(
  buckets: DailyBucket[],
  rows: readonly GovernanceCostProviderDayRow[],
  interval: TimeInterval,
): WithheldBucket[] {
  const shortfallsByPeriod = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    if (!rowIsShort(row)) continue;
    const period = bucketStartOf(row.day, interval);
    const byProvider = shortfallsByPeriod.get(period) ?? new Map<string, Set<string>>();
    const currencies = byProvider.get(row.provider) ?? new Set<string>();
    for (const currency of row.currenciesWithoutUsdAmount) currencies.add(currency);
    byProvider.set(row.provider, currencies);
    shortfallsByPeriod.set(period, byProvider);
  }
  return buckets.map((bucket) => {
    const withheldProviders = shortfallsOf(shortfallsByPeriod.get(bucket.day));
    return {
      ...bucket,
      withheld: withheldProviders.length > 0,
      withheldProviders,
    };
  });
}

/** A provider→currencies map as a sorted list, or nothing for no map. */
function shortfallsOf(
  byProvider: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): ProviderShortfall[] {
  if (!byProvider) return [];
  return [...byProvider.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([provider, currencies]) => ({
      provider,
      currencies: [...currencies].toSorted(),
    }));
}

/** The rows as one stackable bucket per day, one series per provider. */
export function providerDayBuckets(rows: readonly GovernanceCostProviderDayRow[]): DailyBucket[] {
  const byDay = new Map<string, DailyBucket>();
  for (const row of rows) {
    let bucket = byDay.get(row.day);
    if (!bucket) {
      bucket = { day: row.day, points: [] };
      byDay.set(row.day, bucket);
    }
    // A withheld day contributes nothing to the height rather than being
    // guessed at. `markWithheldPeriods` is what says the height is short.
    bucket.points.push({
      key: row.provider,
      label: providerName(row.provider),
      value: row.amountUsd ?? 0,
    });
  }
  return [...byDay.values()].toSorted((a, b) => a.day.localeCompare(b.day));
}

/** The same rows folded to one entry per (period, provider). */
export function providerPeriods(
  rows: readonly GovernanceCostProviderDayRow[],
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
        partial: rowIsShort(row),
      });
      continue;
    }
    if (row.day < held.fromDay) held.fromDay = row.day;
    if (row.day > held.toDay) held.toDay = row.day;
    held.amountUsd += row.amountUsd ?? 0;
    held.partial = held.partial || rowIsShort(row);
  }
  return [...byKey.values()].toSorted(
    (a, b) => a.provider.localeCompare(b.provider) || a.period.localeCompare(b.period),
  );
}

/**
 * One phrase per provider whose bars are short, naming the currency when the
 * shortfall has one.
 *
 * Built from the buckets the chart draws rather than from the rows a second
 * time, so the note under a chart names exactly the providers whose bars it
 * marked: one fold, read twice. Exported for the same reason the bucket
 * builders above are — it is the whole of a claim the screen makes in prose,
 * and a claim about money is worth testing without a chart in the way.
 *
 * A provider short both ways — some cells with no amount at all, some billed
 * in a currency we could not convert — is listed ONCE, with its currencies,
 * however many periods it was short in. Two entries for one provider would
 * read as two providers, and the reader is being told which names to go and
 * look at.
 */
export function partialProviderNotes(buckets: readonly WithheldBucket[]): string[] {
  const currenciesByProvider = new Map<string, Set<string>>();
  for (const bucket of buckets) {
    for (const { provider, currencies } of bucket.withheldProviders) {
      const held = currenciesByProvider.get(provider) ?? new Set<string>();
      for (const currency of currencies) held.add(currency);
      currenciesByProvider.set(provider, held);
    }
  }
  return shortfallsOf(currenciesByProvider).map(({ provider, currencies }) => {
    const name = providerName(provider);
    if (currencies.length === 0) return name;
    return `${name} (${currencies.join(", ")})`;
  });
}
