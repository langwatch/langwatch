import { Box, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import type {
  GovernanceSeatLaneDto,
  GovernanceSeatPoolDto,
} from "@ee/governance/services/governanceCost.service";
import type { ReactNode } from "react";

import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { MeterBar } from "~/components/ui/MeterBar";

import { CHART_SEAT_FILL } from "./chartTheme";
import {
  formatLaneCurrencyTotal,
  formatLaneUsd,
  laneTrendBadge,
  laneWithheldTotalNote,
  seatPoolName,
} from "./costLaneFormat";
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
  currencyTotals,
  laneNote,
  belowTotalNote,
  trendPct,
  sample = false,
  testId,
  children,
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
   * One total per currency the lane was billed in.
   *
   * The US dollar entry IS `amountUsd` and is already the headline, so only
   * the others are drawn — printing it twice would put two figures for one
   * amount on one card, which is the shape of every defect this screen is
   * built against.
   */
  currencyTotals?: ReadonlyArray<{
    currencyCode: string;
    amount: number | null;
    cellsWithoutAmount: number;
  }>;
  /**
   * A read-side sentence explaining this lane's figure or its absence — the
   * Azure billing note today. Rendered verbatim: the panel never composes
   * copy about money, it shows what the read side decided to say.
   */
  laneNote?: string | null;
  /**
   * A note pinned UNDER THE TOTAL, on the face of the card — the metered
   * lane's "N requests with no dollar amount". Distinct from `laneNote`, which
   * lives behind the (i): this is a caveat on the figure beside it and a reader
   * needs it in front of them, not on a hover. Shown only when the lane states
   * a figure it does not withhold (`cellsWithoutAmount` is zero); a withheld
   * lane's own note takes the slot.
   */
  belowTotalNote?: string | null;
  /**
   * Which way this lane is running, already measured. Measured by the caller
   * on the UNFOLDED series, not derived from anything drawn here: a calendar
   * bucket is not a unit of time you may compare, and a partial January
   * beside a full April reports change that is a property of the months.
   */
  trendPct?: number | null;
  /**
   * Whether this lane's figure is invented. Never optional in practice on a
   * sample lane: an unbadged figure in the house typeface reads as measured
   * whether or not it was, and this one is the largest number on the screen.
   */
  sample?: boolean;
  testId: string;
  /** Optional detail belonging to this lane, below its figure. */
  children?: ReactNode;
}) {
  const badge = laneTrendBadge(trendPct ?? null);
  // The lane's own sentence, and whatever the read side had to add about it —
  // one piece of prose, because a tooltip that opened on two paragraphs of
  // different provenance would read as two tooltips that collided.
  const aboutThisLane = [description, laneNote].filter(Boolean).join(" ");
  // NO RATE IS APPLIED and nothing here is added to the headline. Money a
  // provider billed in euros is money we can state exactly, and it gets its
  // own line rather than being folded into a dollar figure nobody was charged
  // (ADR-128 §3).
  const otherCurrencies = (currencyTotals ?? []).filter(
    (total) => total.currencyCode !== "USD",
  );
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
          {/* WHAT THE LANE IS goes here rather than under the figure. Three
              cards sit in a row and each closed on a paragraph, which set the
              row's height by its longest sentence and left the shortest card
              with a hole in the middle. The sentence is read once, when a
              reader first meets the card; the figure is read every time. */}
          <FieldInfoTooltip
            description={aboutThisLane}
            testId={`${testId}-about`}
            trigger="hover"
          />
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
              title="An average period in the later half of this window against an average period in the earlier half."
            >
              {badge}
            </Text>
          )}
        </HStack>
        {otherCurrencies.length > 0 && (
          <VStack align="start" gap={0}>
            {otherCurrencies.map((total) => (
              <Text
                key={total.currencyCode}
                fontSize="sm"
                color="fg.muted"
                fontVariantNumeric="tabular-nums"
              >
                {formatLaneCurrencyTotal(total)}
              </Text>
            ))}
          </VStack>
        )}
        {children}
        {/* THIS ONE STAYS ON THE CARD. Everything else the lane has to say is
            about what it measures, and a reader needs that once. This says the
            figure beside it is not the whole figure — and a caveat on a number
            that only appears when the reader goes looking for it is a caveat
            that will be missed by exactly the reader who needed it. */}
        {cellsWithoutAmount > 0 ? (
          <Text
            fontSize="xs"
            color="fg.subtle"
            marginTop="auto"
            data-testid={`${testId}-note`}
          >
            {laneWithheldTotalNote()}
          </Text>
        ) : belowTotalNote ? (
          // A stated figure with a caveat beside it — the metered lane's count
          // of requests carrying no dollar amount. Not a withheld total: the
          // figure above it stands.
          <Text
            fontSize="xs"
            color="fg.subtle"
            marginTop="auto"
            data-testid={`${testId}-note`}
          >
            {belowTotalNote}
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
          <FieldInfoTooltip
            description="Seats your provider reports as bought, and how many are assigned to someone."
            testId={`${testId}-about`}
            trigger="hover"
          />
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
