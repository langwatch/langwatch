import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { type DetailPayload, MISSING_VALUE } from "@langwatch/coding-agent-web";
import type React from "react";

import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";

import { EmptySection, Section } from "@langwatch/coding-agent-web";

type ModelUsage = DetailPayload["modelBreakdown"][number];

/**
 * One model's line: what it consumed, and a bar scaled against the heaviest
 * model on the pull request.
 *
 * An entry whose totals are not known is named and nothing more. There is no
 * figure to print and nothing to scale a bar against, and drawing either would
 * be a claim the read did not make.
 */
const ModelRow: React.FC<{ model: ModelUsage; peak: number }> = ({
  model,
  peak,
}) => (
  <VStack align="stretch" gap={1}>
    <HStack justify="space-between" gap={3}>
      <Text fontSize="sm" truncate>
        {model.model}
      </Text>
      {model.tokensKnown ? (
        <HStack gap={3} flexShrink={0}>
          <Text fontSize="sm" color="fg.muted">
            {formatTokens(model.totalTokens)} tokens
          </Text>
          <Text fontSize="sm" color="fg.muted">
            {model.costUsd === null ? MISSING_VALUE : formatCost(model.costUsd)}
          </Text>
        </HStack>
      ) : null}
    </HStack>
    {model.tokensKnown ? (
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
    ) : null}
  </VStack>
);

/** What each model consumed, heaviest first. */
export const ModelsSection: React.FC<{
  models: DetailPayload["modelBreakdown"];
}> = ({ models }) => {
  const peak = models.reduce(
    (max, model) => Math.max(max, model.totalTokens),
    0,
  );
  return (
    <Section title="Models">
      {models.length === 0 ? (
        <EmptySection>No model data for this pull request yet</EmptySection>
      ) : (
        <VStack align="stretch" gap={3}>
          {models.map((model) => (
            <ModelRow key={model.model} model={model} peak={peak} />
          ))}
        </VStack>
      )}
    </Section>
  );
};
