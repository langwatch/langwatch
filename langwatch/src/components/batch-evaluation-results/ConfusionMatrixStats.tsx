/**
 * The statistics that sit beside the matrix — the chance-agreement plot and
 * the single-figure metrics. Split out of ConfusionMatrixDrawer so the drawer
 * stays a layout, not a layout plus three presentational widgets.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import type { ConfidenceInterval } from "./computeConfusionMatrix";
import { formatPercent } from "./confusionMatrixDisplay";

/**
 * Plots accuracy against the agreement chance alone would have produced.
 *
 * This is the visual form of the kappa argument. A judge scoring 90% on a
 * set that is 90% passes has done nothing, and a bare "90%" hides that
 * completely — here the shaded floor swallows the marker and the point is
 * immediate. The confidence band is drawn at the same scale so a thin
 * sample reads as a wide, hesitant smear rather than a crisp number.
 */
export function AgreementBar({
  accuracy,
  interval,
  chance,
}: {
  accuracy: number;
  interval: ConfidenceInterval | null;
  chance: number | null;
}) {
  const asWidth = (value: number) => `${Math.min(100, value * 100)}%`;
  const clearsChance = chance !== null && accuracy > chance;

  return (
    <Box>
      <HStack justify="space-between" marginBottom={1.5}>
        <Text fontSize="xs" fontWeight="semibold">
          Is this better than chance?
        </Text>
        {chance !== null ? (
          <Text
            fontSize="2xs"
            fontWeight="semibold"
            color={clearsChance ? "green.fg" : "orange.fg"}
          >
            {clearsChance
              ? `+${Math.round((accuracy - chance) * 100)} pts over chance`
              : "at or below chance"}
          </Text>
        ) : null}
      </HStack>

      <Box
        position="relative"
        height="30px"
        bg="bg.muted"
        borderRadius="sm"
        borderWidth="1px"
        borderColor="border"
        overflow="hidden"
      >
        {/* Everything left of this line is free — a judge gets it for
            nothing by matching the base rate. */}
        {chance !== null ? (
          <Box
            position="absolute"
            insetStart={0}
            top={0}
            bottom={0}
            width={asWidth(chance)}
            bg="bg.emphasized"
          />
        ) : null}

        {/* Plausible range for the true accuracy, not just the point estimate. */}
        {interval ? (
          <Box
            position="absolute"
            top="7px"
            bottom="7px"
            insetStart={asWidth(interval.lower)}
            width={asWidth(interval.upper - interval.lower)}
            bg="blue.muted"
            borderRadius="sm"
          />
        ) : null}

        {chance !== null ? (
          <Box
            position="absolute"
            top={0}
            bottom={0}
            insetStart={asWidth(chance)}
            width="2px"
            bg="border.emphasized"
          />
        ) : null}

        <Box
          position="absolute"
          top={0}
          bottom={0}
          insetStart={asWidth(accuracy)}
          width="3px"
          bg="blue.solid"
        />
      </Box>

      <HStack justify="space-between" marginTop={1}>
        <Text fontSize="2xs" color="fg.muted">
          0%
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          chance {formatPercent(chance)} · observed {formatPercent(accuracy)}
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          100%
        </Text>
      </HStack>
    </Box>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <VStack gap={0} align="start">
      <Text fontSize="lg" fontWeight="bold">
        {value}
      </Text>
      <Text fontSize="2xs" color="fg.muted">
        {label}
      </Text>
    </VStack>
  );
}
