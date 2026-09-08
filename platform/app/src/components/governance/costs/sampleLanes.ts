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
import { SAMPLE_SEAT_POOLS } from "./sampleSeries";

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
  const series: GovernanceCostDayDto[] = periods.map((day, index) => {
    const drift = 1 + Math.sin(index / 2.4) * 0.18;
    return {
      day,
      billedUsd: Math.round(BILLED_PER_PERIOD * drift),
      gatewayUsd: Math.round(GATEWAY_PER_PERIOD * drift),
      billedCellsWithoutAmount: 0,
      gatewayCellsWithoutAmount: 0,
      billedRevisedAt: null,
      billedPreviousUsd: null,
      billedProvisional: false,
    };
  });

  return {
    unavailableReason: null,
    billed: {
      amountUsd: series.reduce((sum, day) => sum + (day.billedUsd ?? 0), 0),
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
    },
    gateway: {
      amountUsd: series.reduce((sum, day) => sum + (day.gatewayUsd ?? 0), 0),
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
    },
    azureBilling: null,
    seats: {
      status: "reported",
      pools: SAMPLE_SEAT_POOLS.map((skuPartNumber, index) => ({
        skuPartNumber,
        day: periods[periods.length - 1] ?? "",
        seatsBought: 140 + index * 60,
        seatsAssigned: 96 + index * 41,
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
 * Billed spend attributed to people, as the provider's own bill reports it.
 *
 * The last row is the not-named bucket, which is where money the provider
 * attributed to nobody gathers. It is here rather than rounded away because
 * it is on every real version of this list and a sample without it would show
 * a tidier screen than the product can deliver.
 */
export function sampleSpenderRows(): SpenderRow[] {
  // Addresses at a reserved test domain rather than invented human names: a
  // plausible name in a screenshot reads as somebody's, and `.test` can never
  // resolve to a real person or a real company.
  // Scaled to a twelve-month window, so this list sums to roughly what the
  // billed lane above it reports. Two panels describing the same bill an order
  // of magnitude apart is the incoherence the rest of the sample data was just
  // fixed for.
  const people: Array<[string, string, number]> = [
    ["openai", "ada@acme.test", 50_160],
    ["anthropic", "grace@acme.test", 43_680],
    ["openai", "alan@acme.test", 34_920],
    ["microsoft", "edsger@acme.test", 25_800],
    ["anthropic", "barbara@acme.test", 20_640],
    ["openai", "linus@acme.test", 13_260],
  ];
  return [
    ...people.map(([provider, label, amountUsd], index) => ({
      provider,
      rawActorId: `sample-actor-${index}`,
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
