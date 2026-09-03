import { Box, Heading, Text, VStack } from "@chakra-ui/react";

import type {
  GovernanceSeatLaneDto,
  GovernanceSeatPoolDto,
} from "@ee/governance/services/governanceCost.service";

import { formatLaneUsd, laneWithheldTotalNote } from "./costLaneFormat";

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
  testId: string;
}) {
  return (
    <Box
      data-testid={testId}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={5}
      flex="1"
      minWidth="200px"
    >
      <VStack align="start" gap={1}>
        <Heading size="xs" color="fg.muted" textTransform="uppercase">
          {label}
        </Heading>
        <Text
          fontSize="2xl"
          fontWeight="semibold"
          fontVariantNumeric="tabular-nums"
        >
          {formatLaneUsd(amountUsd)}
        </Text>
        <Text fontSize="sm" color="fg.muted">
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
  testId,
}: {
  seats: GovernanceSeatLaneDto;
  testId: string;
}) {
  const reported = seats.status === "reported";
  return (
    <Box
      data-testid={testId}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      borderStyle={reported ? "solid" : "dashed"}
      padding={5}
      flex="1"
      minWidth="200px"
    >
      <VStack align="start" gap={1}>
        <Heading size="xs" color="fg.muted" textTransform="uppercase">
          Seats
        </Heading>
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
 * The licence pools, one line each.
 *
 * Both numbers on the same line and in the same sentence, because the reader's
 * question is the difference between them. A pool's counts are shown as its
 * provider reports them — nothing is summed across pools, since a Copilot seat
 * and a Power Platform seat are not interchangeable and a total would suggest
 * they are.
 */
function SeatPools({ pools }: { pools: GovernanceSeatPoolDto[] }) {
  return (
    <VStack align="start" gap={2} width="full">
      {pools.map((pool) => (
        <VStack key={pool.skuPartNumber} align="start" gap={0} width="full">
          <Text fontSize="sm" fontWeight="medium">
            {pool.skuPartNumber}
          </Text>
          <Text
            fontSize="sm"
            color="fg.muted"
            fontVariantNumeric="tabular-nums"
          >
            {pool.seatsAssigned} of {pool.seatsBought} seats assigned
          </Text>
        </VStack>
      ))}
      <Text fontSize="xs" color="fg.subtle">
        Seats your provider reports as bought, and how many are assigned to
        someone.
      </Text>
    </VStack>
  );
}
