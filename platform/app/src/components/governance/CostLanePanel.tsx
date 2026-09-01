import { Box, Heading, Text, VStack } from "@chakra-ui/react";

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
      </VStack>
    </Box>
  );
}

/**
 * The seat lane, which has no producer yet.
 *
 * It takes no amount and renders no digits — deliberately, and the test that
 * pins it reads accessible names too. Seat licence ingestion and the dated
 * price list ship separately; until then this lane says it is waiting rather
 * than showing a zero, because a zero here would be a statement about money
 * nobody has measured.
 *
 * LangWatch's own subscription seats are a different product concept and must
 * never be shown here.
 *
 * Keep this copy free of digits — no counts, no dates, no wave numbers — or
 * the digit-free assertion breaks, and that break is the point.
 */
export function SeatLanePanel({ testId }: { testId: string }) {
  return (
    <Box
      data-testid={testId}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      borderStyle="dashed"
      padding={5}
      flex="1"
      minWidth="200px"
    >
      <VStack align="start" gap={1}>
        <Heading size="xs" color="fg.muted" textTransform="uppercase">
          Seats
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Seat data is not yet available.
        </Text>
        <Text fontSize="sm" color="fg.muted">
          What you pay for seats will appear here once seat licences are
          collected.
        </Text>
      </VStack>
    </Box>
  );
}
