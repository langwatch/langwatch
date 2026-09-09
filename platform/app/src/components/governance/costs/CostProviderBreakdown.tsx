import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { GovernanceCostSummaryDto } from "@ee/governance/services/governanceCost.service";

import { formatLaneUsd } from "../costLaneFormat";
import { CostRankList } from "./CostCharts";

const PROVIDER_NAMES: Record<string, string> = {
  openai_admin: "OpenAI",
  anthropic_admin: "Anthropic",
  databricks_genie: "Databricks",
  copilot_studio: "Microsoft Copilot Studio (Purview)",
  copilot_studio_dataverse: "Microsoft Copilot Studio",
};

const providerName = (provider: string) =>
  PROVIDER_NAMES[provider] ?? (provider || "Unknown provider");

/** Provider reporting needs no person attribution. Missing USD stays unknown. */
export function CostProviderBreakdown({
  providers,
}: {
  providers: GovernanceCostSummaryDto["providers"];
}) {
  if (providers.length === 0) return null;

  const priced = providers.flatMap((row) =>
    row.amountUsd === null
      ? []
      : [
          {
            key: row.provider,
            label: providerName(row.provider),
            value: row.amountUsd,
          },
        ],
  );

  return (
    <Box width="full" paddingY={3} aria-label="Cost by provider">
      {priced.length > 0 && (
        <CostRankList
          rows={priced}
          maxRows={priced.length}
          format={formatLaneUsd}
        />
      )}
      <VStack align="stretch" gap={2} marginTop={priced.length > 0 ? 2 : 0}>
        {providers
          .filter((row) => row.amountUsd === null)
          .map((row) => (
            <HStack
              key={row.provider}
              justify="space-between"
              fontSize="sm"
              gap={3}
            >
              <Text>{providerName(row.provider)}</Text>
              <Text color="fg.muted">USD amount unavailable</Text>
            </HStack>
          ))}
      </VStack>
    </Box>
  );
}
