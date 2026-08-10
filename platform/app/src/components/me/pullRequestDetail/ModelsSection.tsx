import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";

import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";

import { type DetailPayload, MISSING_VALUE } from "./detailPayload";
import { EmptySection, Section } from "./Section";

/**
 * What each model consumed, with a bar scaled to the heaviest of them.
 *
 * When no per-call totals exist the section still names the models the
 * sessions recorded, without bars: there is nothing to scale them against, and
 * a bar drawn over an unknown split would be a claim we cannot make.
 */
export const ModelsSection: React.FC<{
  models: DetailPayload["modelBreakdown"];
  names: DetailPayload["modelNames"];
}> = ({ models, names }) => {
  const peak = models.reduce(
    (max, model) => Math.max(max, model.totalTokens),
    0,
  );
  return (
    <Section title="Models">
      {models.length === 0 && names.length === 0 ? (
        <EmptySection>No model data for this pull request yet</EmptySection>
      ) : models.length === 0 ? (
        <VStack align="stretch" gap={2}>
          {names.map((name) => (
            <Text key={name} fontSize="sm" truncate>
              {name}
            </Text>
          ))}
        </VStack>
      ) : (
        <VStack align="stretch" gap={3}>
          {models.map((model) => (
            <VStack key={model.model} align="stretch" gap={1}>
              <HStack justify="space-between" gap={3}>
                <Text fontSize="sm" truncate>
                  {model.model}
                </Text>
                <HStack gap={3} flexShrink={0}>
                  <Text fontSize="sm" color="fg.muted">
                    {formatTokens(model.totalTokens)} tokens
                  </Text>
                  <Text fontSize="sm" color="fg.muted">
                    {model.costUsd === null
                      ? MISSING_VALUE
                      : formatCost(model.costUsd)}
                  </Text>
                </HStack>
              </HStack>
              <Box
                height="3px"
                bg="border.subtle"
                borderRadius="full"
                overflow="hidden"
              >
                <Box
                  height="full"
                  width={`${peak > 0 ? (model.totalTokens / peak) * 100 : 0}%`}
                  bg="blue.fg"
                  borderRadius="full"
                />
              </Box>
            </VStack>
          ))}
        </VStack>
      )}
    </Section>
  );
};
