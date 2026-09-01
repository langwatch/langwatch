import { Box, Heading, Text, VStack } from "@chakra-ui/react";

import type {
  GovernanceSeatLaneDto,
  GovernanceSeatPoolDto,
} from "@ee/governance/services/governanceCost.service";

import { formatLaneUsd } from "./costLaneFormat";

/**
 * One cost lane, labeled for what it measures.
 *
 * The lanes are never summed. They count different things — a provider's
 * invoice and the gateway's own meter answer different questions and disagree
 * on purpose — so each panel states its own figure under its own label and the
 * screen offers no total.
 */
export function CostLanePanel({
  label,
  description,
  amountUsd,
  cellsWithoutAmount,
  testId,
}: {
  label: string;
  description: string;
  /** Null when no figure is held. Rendered as an em dash, never as zero. */
  amountUsd: number | null;
  /** Cells summarized without a stated amount, if any. */
  cellsWithoutAmount: number;
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
          <Text fontSize="xs" color="fg.subtle">
            Some usage in this lane arrived without a stated amount and is not
            included.
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
 * With nothing read yet the lane says so rather than showing a zero, and that
 * copy must stay free of digits — no counts, no dates, no wave numbers — or
 * the digit-free assertion on the waiting state breaks, and that break is the
 * point.
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
  const awaiting = seats.status === "awaiting_data";
  return (
    <Box
      data-testid={testId}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      borderStyle={awaiting ? "dashed" : "solid"}
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
          <>
            <Text fontSize="sm" color="fg.muted">
              Seat data is not yet available.
            </Text>
            <Text fontSize="sm" color="fg.muted">
              How many seats are bought, and how many are assigned to someone,
              will appear here once seat licences are collected.
            </Text>
          </>
        )}
      </VStack>
    </Box>
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
