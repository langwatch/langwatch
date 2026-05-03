import {
  Box,
  Heading,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { CodingAssistantTile } from "./tiles/CodingAssistantTile";
import { ExternalToolTile } from "./tiles/ExternalToolTile";
import { ModelProviderTile } from "./tiles/ModelProviderTile";
import type {
  AiToolEntry,
  CodingAssistantConfig,
  ExternalToolConfig,
  ModelProviderConfig,
} from "./tiles/types";

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
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const listQuery = api.aiTools.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const entries = (listQuery.data ?? []) as unknown as AiToolEntry[];

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
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={6}
        backgroundColor="bg.subtle"
      >
        <VStack align="start" gap={2}>
          <Heading as="h3" size="md">
            Your AI tools portal
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Your admin hasn't added any AI tools to your portal yet. In the
            meantime, you can install the LangWatch CLI and run{" "}
            <code>langwatch login</code> to get started with a coding
            assistant of your choice.
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
                <RenderTile key={entry.id} entry={entry} orgId={orgId} />
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
}: {
  entry: AiToolEntry;
  orgId: string;
}) {
  switch (entry.type) {
    case "coding_assistant":
      return (
        <CodingAssistantTile
          displayName={entry.displayName}
          config={entry.config as CodingAssistantConfig}
          iconKey={entry.iconKey}
        />
      );
    case "model_provider":
      return (
        <ModelProviderTile
          displayName={entry.displayName}
          config={entry.config as ModelProviderConfig}
          organizationId={orgId}
          iconKey={entry.iconKey}
        />
      );
    case "external_tool":
      return (
        <ExternalToolTile
          displayName={entry.displayName}
          config={entry.config as ExternalToolConfig}
          iconKey={entry.iconKey}
        />
      );
  }
}
