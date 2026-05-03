import {
  Box,
  Heading,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";

import { CodingAssistantTile } from "./tiles/CodingAssistantTile";
import { ExternalToolTile } from "./tiles/ExternalToolTile";
import { MOCK_TOOL_CATALOG } from "./tiles/mockCatalog";
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
  // TODO(B9): replace MOCK_TOOL_CATALOG with
  // `api.aiTools.list({ organizationId }).useQuery(...)` once Sergey's
  // `aiToolsCatalogRouter` ships. The shape of `entries` matches the
  // backend response 1:1 — only the source swaps.
  const entries = MOCK_TOOL_CATALOG;

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
                <RenderTile key={entry.id} entry={entry} />
              ))}
            </SimpleGrid>
          </VStack>
        );
      })}
    </VStack>
  );
}

function RenderTile({ entry }: { entry: AiToolEntry }) {
  switch (entry.type) {
    case "coding_assistant":
      return (
        <CodingAssistantTile
          displayName={entry.displayName}
          config={entry.config as CodingAssistantConfig}
        />
      );
    case "model_provider":
      return (
        <ModelProviderTile
          displayName={entry.displayName}
          config={entry.config as ModelProviderConfig}
        />
      );
    case "external_tool":
      return (
        <ExternalToolTile
          displayName={entry.displayName}
          config={entry.config as ExternalToolConfig}
        />
      );
  }
}
