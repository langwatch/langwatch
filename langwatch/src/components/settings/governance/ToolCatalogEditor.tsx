import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { GripVertical, Plus } from "lucide-react";

import type { AiToolEntry } from "~/components/me/tiles/types";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

const SECTION_LABELS: Record<AiToolEntry["type"], string> = {
  coding_assistant: "Coding assistants",
  model_provider: "Model providers",
  external_tool: "Internal tools",
};

const SECTION_ORDER: AiToolEntry["type"][] = [
  "coding_assistant",
  "model_provider",
  "external_tool",
];

interface Props {
  organizationId: string;
  onAddTile: (type: AiToolEntry["type"]) => void;
  onEditTile: (entry: AiToolEntry) => void;
}

export function ToolCatalogEditor({
  organizationId,
  onAddTile,
  onEditTile,
}: Props) {
  const utils = api.useUtils();

  const adminListQuery = api.aiTools.adminList.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const setEnabledMutation = api.aiTools.setEnabled.useMutation({
    onSuccess: () => {
      void utils.aiTools.adminList.invalidate({ organizationId });
      void utils.aiTools.list.invalidate({ organizationId });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to update tile",
        description: err.message,
        type: "error",
      });
    },
  });

  if (adminListQuery.isLoading) {
    return (
      <HStack padding={6} justifyContent="center">
        <Spinner size="sm" />
        <Text fontSize="sm" color="fg.muted">
          Loading catalog…
        </Text>
      </HStack>
    );
  }

  const entries = (adminListQuery.data ?? []) as unknown as AiToolEntry[];

  const grouped: Record<AiToolEntry["type"], AiToolEntry[]> = {
    coding_assistant: [],
    model_provider: [],
    external_tool: [],
  };
  for (const e of entries) grouped[e.type].push(e);
  for (const t of SECTION_ORDER) {
    grouped[t].sort((a, b) => a.order - b.order);
  }

  return (
    <VStack align="stretch" gap={6} width="full">
      {SECTION_ORDER.map((type) => {
        const items = grouped[type];
        return (
          <VStack key={type} align="stretch" gap={2}>
            <HStack>
              <Heading as="h3" size="sm">
                {SECTION_LABELS[type]} ({items.length})
              </Heading>
              <Button
                size="xs"
                variant="outline"
                marginLeft="auto"
                onClick={() => onAddTile(type)}
              >
                <Plus size={14} /> Add tile
              </Button>
            </HStack>

            {items.length === 0 ? (
              <Box
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="sm"
                padding={4}
                backgroundColor="bg.subtle"
              >
                <Text fontSize="xs" color="fg.muted">
                  No {SECTION_LABELS[type].toLowerCase()} configured. Click{" "}
                  <strong>Add tile</strong> to publish one.
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={1}>
                {items.map((entry) => (
                  <CatalogRow
                    key={entry.id}
                    entry={entry}
                    onEdit={() => onEditTile(entry)}
                    onToggleEnabled={() =>
                      setEnabledMutation.mutate({
                        organizationId,
                        id: entry.id,
                        enabled: !entry.enabled,
                      })
                    }
                    isPending={
                      setEnabledMutation.isPending &&
                      setEnabledMutation.variables?.id === entry.id
                    }
                  />
                ))}
              </VStack>
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}

function CatalogRow({
  entry,
  onEdit,
  onToggleEnabled,
  isPending,
}: {
  entry: AiToolEntry;
  onEdit: () => void;
  onToggleEnabled: () => void;
  isPending: boolean;
}) {
  const scopeLabel =
    entry.scope === "organization"
      ? "Org-wide"
      : `Team: ${entry.scopeId.slice(0, 12)}`;

  return (
    <HStack
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={2}
      gap={2}
      opacity={entry.enabled ? 1 : 0.5}
    >
      <Box color="fg.muted" cursor="grab">
        <GripVertical size={16} />
      </Box>
      <Text fontSize="sm" flex={1} fontWeight="medium">
        {entry.displayName}
      </Text>
      <Badge variant="subtle" colorPalette="gray" fontSize="xs">
        {scopeLabel}
      </Badge>
      <Button size="xs" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={onToggleEnabled}
        disabled={isPending}
      >
        {entry.enabled ? "Disable" : "Enable"}
      </Button>
    </HStack>
  );
}
