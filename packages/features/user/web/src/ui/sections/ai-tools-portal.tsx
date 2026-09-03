import { Box, Heading, SimpleGrid, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";

import { api } from "../../behavior/personal-workspace-api";
import { useOrganizationTeamProject } from "../../behavior/personal-workspace-session";
import { ExternalToolTile } from "../blocks/external-tool-tile";
import { CodingAssistantTile } from "./coding-assistant-tile";
import { GovernanceGettingStartedBanner } from "./governance-getting-started-banner";
import { ModelProviderTile } from "./model-provider-tile";
import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";
import type { AiToolConfigOf } from "../../model/ai-tool-config";

const SECTION_LABELS: Record<AiToolEntry["type"], string> = {
  coding_assistant: "Coding assistants",
  model_provider: "Model providers (issue your own virtual key)",
  external_tool: "Internal tools",
};

const SECTION_ORDER: AiToolEntry["type"][] = [
  "coding_assistant",
  "model_provider",
  "external_tool",
];

export function AiToolsPortal() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const orgId = organization?.id ?? "";
  const canManageCatalog = hasPermission("aiTools:manage");

  const listQuery = api.aiTools.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const availabilityQuery = api.aiTools.providerAvailability.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  // Stay `undefined` until the preflight resolves so model-provider
  // tiles default to "configured" during the load window — a brief
  // flicker of "Provider not configured" at every tile on page-open
  // would be louder than any single false positive (and less honest
  // than the empty-set we'd get from an absent query result).
  const configuredProviders = useMemo<Set<string> | undefined>(
    () =>
      availabilityQuery.data ? new Set(availabilityQuery.data.configuredProviders) : undefined,
    [availabilityQuery.data],
  );

  // No cast: the read hands over the contract's own `AiToolEntry`, which is
  // what the procedure map declares and what these tiles now name.
  const entries: AiToolEntry[] = listQuery.data ?? [];

  const grouped = useMemo(() => {
    const byType: Record<AiToolEntry["type"], AiToolEntry[]> = {
      coding_assistant: [],
      model_provider: [],
      external_tool: [],
    };
    for (const e of entries) {
      if (!e.enabled) continue;
      byType[e.type].push(e);
    }
    for (const t of SECTION_ORDER) {
      byType[t].sort((a, b) => a.order - b.order);
    }
    return byType;
  }, [entries]);

  const totalEnabled = entries.filter((e) => e.enabled).length;

  if (listQuery.isLoading) {
    return (
      <VStack align="stretch" gap={6} width="full">
        {SECTION_ORDER.map((type) => (
          <VStack key={type} align="stretch" gap={3}>
            <Skeleton height="14px" width="180px" />
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={3}>
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} height="60px" borderRadius="md" />
              ))}
            </SimpleGrid>
          </VStack>
        ))}
      </VStack>
    );
  }

  if (totalEnabled === 0) {
    // Admins get the getting-started hero pointing at the tool catalog;
    // members (who cannot publish tools) get a plain "nothing here yet" note.
    if (canManageCatalog) {
      return <GovernanceGettingStartedBanner />;
    }
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={6}
        backgroundColor="bg.subtle"
        width="full"
      >
        <VStack align="start" gap={2}>
          <Heading as="h3" size="md">
            Your AI tools portal
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Your admin hasn&apos;t added any AI tools to your portal yet. Check back once they
            publish your team&apos;s coding assistants and model providers.
          </Text>
        </VStack>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={6} width="full">
      {SECTION_ORDER.map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        return (
          <VStack key={type} align="stretch" gap={3}>
            <Heading as="h3" size="sm" color="fg.muted">
              {SECTION_LABELS[type]}
            </Heading>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={3}>
              {items.map((entry) => (
                <RenderTile
                  key={entry.id}
                  entry={entry}
                  orgId={orgId}
                  configuredProviders={configuredProviders}
                />
              ))}
            </SimpleGrid>
          </VStack>
        );
      })}
    </VStack>
  );
}

function RenderTile({
  entry,
  orgId,
  configuredProviders,
}: {
  entry: AiToolEntry;
  orgId: string;
  configuredProviders: Set<string> | undefined;
}) {
  switch (entry.type) {
    case "coding_assistant":
      return (
        <CodingAssistantTile
          displayName={entry.displayName}
          config={entry.config as AiToolConfigOf<"coding_assistant">}
          iconAsset={entry.iconAsset}
          iconKey={entry.iconKey}
        />
      );
    case "model_provider": {
      const cfg = entry.config as AiToolConfigOf<"model_provider">;
      return (
        <ModelProviderTile
          displayName={entry.displayName}
          config={cfg}
          organizationId={orgId}
          iconAsset={entry.iconAsset}
          iconKey={entry.iconKey}
          providerConfigured={
            configuredProviders ? configuredProviders.has(cfg.providerKey) : undefined
          }
        />
      );
    }
    case "external_tool":
      return (
        <ExternalToolTile
          displayName={entry.displayName}
          config={entry.config as AiToolConfigOf<"external_tool">}
          iconAsset={entry.iconAsset}
          iconKey={entry.iconKey}
        />
      );
  }
}
