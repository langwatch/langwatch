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
    return {
      day,
      billedUsd: Math.round(BILLED_PER_PERIOD * billedDrift),
      gatewayUsd: Math.round(GATEWAY_PER_PERIOD * gatewayDrift),
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
 * Billed spend attributed to API keys, as the provider's own bill reports it.
 *
 * KEYS, NOT PEOPLE. The pulled lane reads a provider invoice, and a provider
 * invoice does not know who anybody is — it knows which credential was
 * presented. This list used to name people, which quietly promised an
 * attribution the billing pipeline cannot make: a shared key used by four
 * engineers appeared on the screen as one person's spend. Naming the key says
 * exactly as much as the bill does, and the reader who wants a person follows
 * the key to whoever holds it.
 *
 * Keys are named for the workload they serve, the way a team names them, and
 * the canonical agents keep their spelling — a key called `checkout-agent` is
 * the one the Agents screen has heard of. The masked tail is what a provider
 * console shows and what an admin matches against; the secret itself is not a
 * thing this product ever holds, let alone invents.
 *
 * The last row is the not-named bucket, which is where money the provider
 * attributed to no key gathers. It is here rather than rounded away because
 * it is on every real version of this list and a sample without it would show
 * a tidier screen than the product can deliver.
 */
export function sampleSpenderRows(): SpenderRow[] {
  // Scaled to a twelve-month window, so this list sums to roughly what the
  // billed lane above it reports. Two panels describing the same bill an order
  // of magnitude apart is the incoherence the rest of the sample data was just
  // fixed for.
  // `name · sk-tail`, not `name (sk-…tail)`. The row is half a panel wide and
  // carries a provider badge as well, so the parenthesised form truncated to
  // "checkout-agent (sk-…" — the mask, which is the whole reason a reader can
  // tell this is a credential and not an agent, was the first thing cut.
  const keys: Array<[string, string, number]> = [
    ["openai", "checkout-agent · sk-9f2a", 50_160],
    ["anthropic", "support-copilot · sk-41c7", 43_680],
    ["openai", "docs-rag · sk-0b83", 34_920],
    ["microsoft", "fraud-triage · sk-7d15", 25_800],
    ["anthropic", "notebooks · sk-c604", 20_640],
    ["openai", "ci-evals · sk-2e98", 13_260],
  ];
  return [
    ...keys.map(([provider, label, amountUsd], index) => ({
      provider,
      rawActorId: `sample-key-${index}`,
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
