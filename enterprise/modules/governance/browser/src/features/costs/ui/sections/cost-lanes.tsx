// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SimpleGrid, VStack } from "@chakra-ui/react";
import {
  type GovernanceCostDay,
  type GovernanceCostSummary,
} from "@langwatch/enterprise-governance-contract";

import {
  azureBillingNoteSentence,
  laneTrendPct,
  meteredRequestsWithoutAmountNote,
} from "../../model/cost-lane-format.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostLanePanel, SeatLanePanel } from "../blocks/cost-lane-panel.tsx";
import { CostProviderBreakdown } from "../blocks/cost-provider-breakdown.tsx";

/**
 * The three lanes, in the same panel shell as everything below them.
 *
 * One height for all three, which is a row of cards and not three cards that
 * happen to be adjacent. The seats lane lists a line per licence pool and the
 * money lanes hold one figure each, so the heights differ by a lot and the
 * ragged bottom edge was the first thing the eye landed on.
 *
 * Letting each card end at its own content was the earlier answer here, and it
 * traded one problem for another: the ragged edge went away and the two money
 * cards became visibly stubby beside the seats card. The height was never the
 * real complaint. Empty box below a figure was, and a shorter card has exactly
 * as much of it — the emptiness just moves outside the border where it reads as
 * a layout that gave up rather than a card with room.
 *
 * So: stretch, and the cards earn the height. Each lane pins its explanation to
 * its own bottom edge (`marginTop="auto"` in CostLanePanel), which puts the
 * slack between the figure and its footing and closes all three lanes on one
 * line. Two aligned edges, top and bottom, and the difference in content sits
 * where a reader reads it as spacing.
 */
export function CostLanes({
  data,
  sample,
}: {
  data: GovernanceCostSummary;
  /** The bucket width in view, which the lane sparklines are folded to. */
  interval: TimeInterval;
  sample: boolean;
}) {
  // Trends use daily rollup totals; provider bars and the billed headline
  // share their own window read so ongoing ingestion cannot split them.
  const seriesOf = (pick: (day: GovernanceCostDay) => number | null) =>
    data.series.map((day) => ({ day: day.day, value: pick(day) }));
  // Measured on the UNFOLDED series. The badge compares two spans and cannot
  // have buckets, because a bucket is whatever number of days the calendar
  // left in it. Folding first made a year of unchanged spend report growth on
  // every day the page could be opened, the size of it set by which quarter
  // today happened to fall in.
  const trendPctOf = (pick: (day: GovernanceCostDay) => number | null) =>
    laneTrendPct(seriesOf(pick));
  return (
    <VStack align="stretch" gap={6}>
      <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
        <CostLanePanel
          testId="cost-lane-billed"
          label="Billed by provider"
          description="Provider-reported costs recorded for this period."
          amountUsd={data.billed.amountUsd}
          cellsWithoutAmount={data.billed.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.billed.currenciesWithoutUsdAmount}
          currencyTotals={data.billed.currencyTotals}
          laneNote={data.azureBilling ? azureBillingNoteSentence(data.azureBilling) : null}
          trendPct={trendPctOf((day) => day.billedUsd)}
          sample={sample}
        >
          <CostProviderBreakdown providers={data.providers ?? []} />
        </CostLanePanel>
        <CostLanePanel
          testId="cost-lane-gateway"
          label="Metered by gateway"
          description="What the gateway measured as it served your traffic."
          amountUsd={data.gateway.amountUsd}
          cellsWithoutAmount={data.gateway.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.gateway.currenciesWithoutUsdAmount}
          currencyTotals={data.gateway.currencyTotals}
          belowTotalNote={meteredRequestsWithoutAmountNote(data.gateway.requestsWithoutAmount)}
          trendPct={trendPctOf((day) => day.gatewayUsd)}
          sample={sample}
        />
        <SeatLanePanel testId="cost-lane-seats" seats={data.seats} sample={sample} />
      </SimpleGrid>
    </VStack>
  );
}
