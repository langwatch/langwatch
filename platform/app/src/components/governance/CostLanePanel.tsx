import { Box, Heading, HStack, Text, VStack } from "@chakra-ui/react";

import type {
  GovernanceSeatLaneDto,
  GovernanceSeatPoolDto,
} from "@ee/governance/services/governanceCost.service";

import type { TimeInterval } from "~/components/governance/filters";
import { MeterBar } from "~/components/ui/MeterBar";

import { CHART_SEAT_FILL } from "./chartTheme";
import {
  formatLaneUsd,
  laneTrendBadge,
  laneTrendPct,
  laneWithheldTotalNote,
  seatPoolName,
} from "./costLaneFormat";
import { LaneSparkline } from "./costs/CostCharts";
import { SampleMark } from "./costs/sampleMark";

/**
 * One cost lane, labeled for what it measures.
 *
 * The lanes are never summed. They count different things — a provider's
 * invoice and the gateway's own meter answer different questions and disagree
 * on purpose — so each panel states its own figure under its own label and the
 * screen offers no total.
 *
 * A lane the read could not total in full arrives with a null amount and a
 * non-zero `cellsWithoutAmount`, and renders as an em dash with the note
 * saying why. The panel never reconstructs a figure from the parts it can see:
 * whether a total is offered is the read side's decision, made once, in
 * `governanceCost.service.ts`.
 */
export function CostLanePanel({
  label,
  description,
  amountUsd,
  cellsWithoutAmount,
  currenciesWithoutUsdAmount,
  laneNote,
  trend,
  interval,
  sample = false,
  testId,
}: {
  label: string;
  description: string;
  /** Null when no figure is held. Rendered as an em dash, never as zero. */
  amountUsd: number | null;
  /** Cells summarized without a stated USD amount, if any. */
  cellsWithoutAmount: number;
  /** Which currencies those cells were billed in. May be empty. */
  currenciesWithoutUsdAmount: readonly string[];
  /**
   * A read-side sentence explaining this lane's figure or its absence — the
   * Azure billing note today. Rendered verbatim: the panel never composes
   * copy about money, it shows what the read side decided to say.
   */
  laneNote?: string | null;
  /**
   * This lane's own series across the window, for the card's sparkline. The
   * same read the figure above it was totalled from, so the shape and the
   * total can never describe different money. Omitted when the read holds no
   * series, in which case the card simply has no sparkline.
   */
  trend?: Array<{ day: string; value: number | null }>;
  /** The bucket width in view, for the sparkline's tooltip heading. */
  interval?: TimeInterval;
  /**
   * Whether this lane's figure is invented. Never optional in practice on a
   * sample lane: an unbadged figure in the house typeface reads as measured
   * whether or not it was, and this one is the largest number on the screen.
   */
  sample?: boolean;
  testId: string;
}) {
  const changePct = trend ? laneTrendPct(trend) : null;
  const badge = laneTrendBadge(changePct);
  return (
    <Box
      data-testid={testId}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      padding={4}
    >
      <VStack align="start" gap={1} height="full">
        <HStack gap={2}>
          <Heading size="sm">{label}</Heading>
          <SampleMark shown={sample} />
        </HStack>
        <HStack gap={2} alignItems="baseline">
          <Text
            fontSize="2xl"
            fontWeight="semibold"
            fontVariantNumeric="tabular-nums"
          >
            {formatLaneUsd(amountUsd)}
          </Text>
          {/* Deliberately uncoloured. Spend rising is a fact about a window,
              not a fault, and a red arrow on it would have this card judging
              an organization's AI programme by whether it grew. The sentence
              behind the badge says what it was measured against, because a
              bare percentage on a card invites the reader to supply their own
              comparison and they will pick the wrong one. */}
          {badge && (
            <Text
              fontSize="xs"
              color="fg.muted"
              fontVariantNumeric="tabular-nums"
              data-testid={`${testId}-trend`}
              title="The later half of this window against the earlier half."
            >
              {badge}
            </Text>
          )}
        </HStack>
        {/* The middle of the card used to be blank, and a reader looking at it
            was owed an answer about what it was for. A lane states one figure,
            and the question a single figure always raises is which way it has
            been moving — so the space holds the window's own shape. */}
        {trend && <LaneSparkline points={trend} interval={interval} />}
        {/* The claim sits at the top of the card and what it means sits at the
            bottom, so three cards of different content still agree on two
            lines. `marginTop="auto"` takes the slack in the middle: a card
            with room to spare shows it between the figure and its footing,
            where it reads as spacing, rather than trailing off the end, where
            it reads as something that failed to load. */}
        <Text fontSize="sm" color="fg.muted" marginTop="auto">
          {description}
        </Text>
        {cellsWithoutAmount > 0 ? (
          <Text fontSize="xs" color="fg.subtle" data-testid={`${testId}-note`}>
            {laneWithheldTotalNote({ currenciesWithoutUsdAmount })}
          </Text>
        ) : null}
        {laneNote ? (
          <Text
            fontSize="xs"
            color="fg.subtle"
            data-testid={`${testId}-lane-note`}
          >
            {laneNote}
          </Text>
        ) : null}
      </VStack>
    </Box>
  );
}

/**
 * The seat lane: how many seats a tenant holds and how many are sat in.
 *
 * COUNTS, never money. Bought minus assigned is the conversation this lane
 * exists for — seats paid for that nobody uses — and neither number alone can
 * say it. What the seats cost is already on the invoice the billed lane shows,
 * so a currency figure here would put the same spend on the screen twice.
 *
 * With nothing read yet the lane says so rather than showing a zero, and a
 * read that failed says THAT instead — the two are different sentences, and a
 * lane that offered only the first would send an admin looking for a licence
 * collection that already ran. Both copies must stay free of digits — no
 * counts, no dates, no wave numbers — or the digit-free assertion on the
 * non-reported states breaks, and that break is the point.
 *
 * LangWatch's own subscription seats are a different product concept and must
 * never be shown here.
 */
export function SeatLanePanel({
  seats,
  sample = false,
  testId,
}: {
  seats: GovernanceSeatLaneDto;
  /** Whether these counts are invented. Same rule as the money lanes. */
  sample?: boolean;
  testId: string;
}) {
  const reported = seats.status === "reported";
  return (
    <Box
      data-testid={testId}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      borderStyle={reported ? "solid" : "dashed"}
      padding={4}
    >
      <VStack align="start" gap={1} height="full">
        <HStack gap={2}>
          <Heading size="sm">Seats</Heading>
          <SampleMark shown={sample} />
        </HStack>
        {seats.status === "reported" ? (
          <SeatPools pools={seats.pools} />
        ) : (
          <SeatLaneWithoutCounts status={seats.status} />
        )}
      </VStack>
    </Box>
  );
}

/**
 * The two ways the lane can hold no counts, each in its own words.
 *
 * Waiting and failing look identical on a screen that only knows how to say
 * one of them, and they ask the reader for opposite things: waiting asks for
 * patience, a failed read asks someone to look at it. Neither copy may carry
 * a digit — see the panel above.
 */
function SeatLaneWithoutCounts({
  status,
}: {
  status: "awaiting_data" | "read_failed";
}) {
  if (status === "read_failed") {
    return (
      <>
        <Text fontSize="sm" color="fg.muted">
          Seat data could not be read.
        </Text>
        <Text fontSize="sm" color="fg.muted">
          The read of your seat licences failed, so the counts are missing
          rather than empty. They appear here as soon as a read succeeds.
        </Text>
      </>
    );
  }
  return (
    <>
      <Text fontSize="sm" color="fg.muted">
        Seat data is not yet available.
      </Text>
      <Text fontSize="sm" color="fg.muted">
        How many seats are bought, and how many are assigned to someone, will
        appear here once seat licences are collected.
      </Text>
    </>
  );
}

/**
 * The licence pools, one row each.
 *
 * ONE ROW, NOT TWO. Each pool used to take a name line and a sentence under
 * it, which made this card half again as tall as the two money lanes beside it
 * and pulled the whole row out of shape. The name and the counts now share a
 * line, and the fill bar beneath carries the comparison the sentence was
 * spelling out: the bar is how much of the pool is sat in, so three pools read
 * as three bars at a glance and the exact figures are there for the reader who
 * wants them.
 *
 * `96 / 140` rather than "96 of 140 seats assigned", with the word moved to
 * the footing that already explains the card. Repeating "seats assigned" on
 * every row spent a line each time to say what the card's title says once.
 *
 * Nothing is summed across pools: a Copilot seat and a Power Platform seat are
 * not interchangeable, and a total would suggest they are.
 */
function SeatPools({ pools }: { pools: GovernanceSeatPoolDto[] }) {
  return (
    <VStack align="start" gap={2} width="full" flex="1" marginTop={1}>
      {pools.map((pool) => (
        <SeatPoolRow key={pool.skuPartNumber} pool={pool} />
      ))}
      {/* Same footing as the money lanes: the explanation goes to the bottom
          of the card, so all three lanes close on the same line. */}
      <Text fontSize="xs" color="fg.subtle" marginTop="auto">
        Seats your provider reports as bought, and how many are assigned to
        someone.
      </Text>
    </VStack>
  );
}

function SeatPoolRow({ pool }: { pool: GovernanceSeatPoolDto }) {
  // A ratio, not a percentage, because that is what the meter takes — and the
  // clamp that used to live here went with it, since the meter clamps. A pool
  // with no seats bought has no fraction to state, which is a different thing
  // from a fraction of zero, so it hands over null and gets the bare track.
  const filled =
    pool.seatsBought > 0 ? pool.seatsAssigned / pool.seatsBought : null;
  return (
    <VStack align="stretch" gap={1} width="full">
      <HStack gap={2} width="full">
        {/* The raw SKU stays reachable on hover: it is what a reader matches
            against the provider's invoice when the two disagree. */}
        <Text
          fontSize="sm"
          fontWeight="medium"
          truncate
          minWidth={0}
          flex="1"
          title={pool.skuPartNumber}
        >
          {seatPoolName(pool.skuPartNumber)}
        </Text>
        <Text
          fontSize="sm"
          color="fg.muted"
          fontVariantNumeric="tabular-nums"
          flexShrink={0}
        >
          {pool.seatsAssigned} / {pool.seatsBought}
        </Text>
      </HStack>
      {/* The unfilled remainder is the idle seats — the thing this lane is on
          the screen for — so the track is drawn, not just the fill.

          This is the shared meter primitive rather than a track Box wrapping a
          fill Box, which is what it was. Hand-rolling it had already produced
          three names for one idea (`data-fill-pct` here, `data-fill-ratio` in
          the primitive, `data-width-pct` in the charts next door) and a track
          on `bg.muted` where every other meter in the product uses
          `border.subtle`.

          The fill does not change colour with the reading, which is where this
          meter parts company with the primitive's other three consumers. They
          measure against a limit somebody typed, so their colour states a
          verdict its reader configured; seats bought is a contract with no
          threshold on it, and grading a pool red for being idle would invent a
          judgement nobody set. The level is carried in the LENGTH, which is how
          a meter carries a level. Rules and the boundary in
          specs/ai-governance/dashboard/governance-ui-controls.feature,
          "A meter is not a trend mark". */}
      <MeterBar
        fillRatio={filled}
        width="full"
        height="4px"
        fillColor={CHART_SEAT_FILL}
        data-testid="seat-pool-meter"
      />
    </VStack>
  );
}
