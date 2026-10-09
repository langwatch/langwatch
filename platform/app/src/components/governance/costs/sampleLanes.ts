/**
 * The invented halves of the two surfaces on this page that are not panels:
 * the three headline lanes, and the billed-spend-by-person list.
 *
 * WHY THESE EXIST AT ALL. Every other sample series on the screen stands in
 * for a measurement the platform does not take yet. These two stand in for
 * reads that exist and did not answer — a failed cost read, a refused spender
 * read, a deployment with no cost store. With sample mode on, the screen's
 * job is to show what a filled-in Costs page looks like, and an error alert
 * across the top of it does not do that. So while sample mode is on the
 * failure is not drawn; the lanes render invented figures under the sample
 * badge instead, and the real alerts come straight back the moment the reader
 * turns sample data off.
 *
 * That trade is only safe because nothing here is unlabelled: the banner under
 * the header says nothing on the page is real, and each lane carries its own
 * badge. Invented money without a badge is indistinguishable from the
 * organization's own, which is the failure the whole sample rule exists to
 * prevent.
 *
 * The figures obey the same honesty rules the real DTO does, because a sample
 * that could not occur teaches the reader a shape the product never shows:
 * lanes are never summed, the seat lane carries counts and no money field at
 * all (ADR-128 §6), and a day whose figure is withheld carries null rather
 * than a stand-in zero (§21).
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import type {
  GovernanceCostDayDto,
  GovernanceCostSummaryDto,
} from "@ee/governance/services/governanceCost.service";

import type { SpenderRow } from "./CostSpenderPanel";
import { sampleSeatPools } from "./sampleSeries";

/**
 * A billed lane that runs a little above the gateway's meter, which is the
 * usual shape: the bill covers traffic the gateway never saw (ADR-128 §2).
 */
const BILLED_PER_PERIOD = 18_400;
const GATEWAY_PER_PERIOD = 13_950;

/**
 * The headline summary for a screen with nothing real on it.
 *
 * `periods` are the bucket starts already in view, so the lane chart's axis is
 * the same axis every other time chart on the page draws — the reader is never
 * asked to compare a quarter on one chart against a day on the next.
 */
export function sampleCostSummary(periods: string[]): GovernanceCostSummaryDto {
  const lastPeriod = periods[periods.length - 1] ?? "";
  const series: GovernanceCostDayDto[] = periods.map((day, index) => {
    // The two lanes drift APART, on purpose. One sine curve drove both, which
    // made them perfectly correlated: the two cards printed the same change
    // figure to the digit, and a reader who noticed had learned that these
    // numbers come from one generator rather than from two things that
    // disagree. The bill and the meter measure different traffic (ADR-128 §2)
    // and move together only roughly, so the gateway's curve is offset from
    // the bill's and swings a little wider.
    const billedDrift = 1 + Math.sin(index / 2.4) * 0.18;
    const gatewayDrift = 1 + Math.sin(index / 2.4 + 0.9) * 0.24;
    const billedUsd = Math.round(BILLED_PER_PERIOD * billedDrift);
    return {
      day,
      billedUsd,
      gatewayUsd: Math.round(GATEWAY_PER_PERIOD * gatewayDrift),
      billedCellsWithoutAmount: 0,
      gatewayCellsWithoutAmount: 0,
      billedRevisedAt: null,
      // Invented spend, all of it in dollars and none of it ever revised. A
      // second currency here would be a made-up story about a customer's
      // billing arrangement on a screen that has no data of its own.
      billedByCurrency: [
        { currencyCode: "USD", amount: billedUsd, previousAmount: null },
      ],
      billedCurrenciesWithoutUsdAmount: [],
      billedProvisional: false,
    };
  });

  return {
    unavailableReason: null,
    billed: {
      amountUsd: series.reduce((sum, day) => sum + (day.billedUsd ?? 0), 0),
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
      currencyTotals: [
        {
          currencyCode: "USD",
          amount: series.reduce((sum, day) => sum + (day.billedUsd ?? 0), 0),
          cellsWithoutAmount: 0,
        },
      ],
    },
    providers: [
      { provider: "openai_admin", share: 0.6 },
      { provider: "anthropic_admin", share: 0.4 },
    ].map(({ provider, share }) => ({
      provider,
      amountUsd:
        series.reduce((sum, day) => sum + (day.billedUsd ?? 0), 0) * share,
      cellsWithoutAmount: 0,
    })),
    gateway: {
      amountUsd: series.reduce((sum, day) => sum + (day.gatewayUsd ?? 0), 0),
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
      currencyTotals: [
        {
          currencyCode: "USD",
          amount: series.reduce((sum, day) => sum + (day.gatewayUsd ?? 0), 0),
          cellsWithoutAmount: 0,
        },
      ],
    },
    azureBilling: null,
    seats: {
      status: "reported",
      // The same generator the seats CHART draws from, asked for the same
      // month. Two invented seat counts on one screen that disagreed would be
      // the incoherence the rest of this module exists to avoid, and this pair
      // sits close enough together that a reader will check.
      pools: sampleSeatPools(lastPeriod).map((pool) => ({
        ...pool,
        day: lastPeriod,
      })),
    },
    series,
    windowDays: periods.length,
    // No warnings on an invented screen. Both notices report a real pipeline
    // going wrong, and inventing one would send a reader to check a source
    // that is pulling perfectly well.
    staleSources: null,
    unpricedWindow: null,
  };
}

/**
 * Sample provider-reported users, matching the real spender query.
 * Keep unnamed spend in the remainder so the sample does not suggest every
 * provider can identify a user for every cost row.
 */
export function sampleSpenderRows(): SpenderRow[] {
  // Scaled to a twelve-month window, so this list sums to roughly what the
  // billed lane above it reports. Two panels describing the same bill an order
  // of magnitude apart is the incoherence the rest of the sample data was just
  // fixed for.
  // Match the read's user grouping. Providers that do not report a user
  // belong in the unattributed remainder, not under an invented key.
  const users: Array<[string, string, number]> = [
    ["openai_admin", "ada@acme.test", 50_160],
    ["databricks_genie", "grace@acme.test", 43_680],
    ["openai_admin", "alan@acme.test", 34_920],
    ["databricks_genie", "edsger@acme.test", 25_800],
    ["openai_admin", "barbara@acme.test", 20_640],
    ["databricks_genie", "ada@acme.test", 13_260],
  ];
  return [
    ...users.map(([provider, label, amountUsd], index) => ({
      provider,
      rawActorId: `sample-user-${index}`,
      label,
      agentId: "",
      amountUsd,
      cellsWithoutAmount: 0,
    })),
    {
      provider: "",
      rawActorId: "",
      label: null,
      agentId: "",
      amountUsd: 29_520,
      cellsWithoutAmount: 0,
    },
  ];
}
