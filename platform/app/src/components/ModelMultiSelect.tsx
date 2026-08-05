import { Box, HStack, Input, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { titleCase } from "../utils/stringCasing";
import { MODEL_ICON_SIZE } from "./llmPromptConfigs/constants";
import { allModelOptions, useModelSelectionOptions } from "./ModelSelector";
import { Checkbox } from "./ui/checkbox";
import { InputGroup } from "./ui/input-group";

/**
 * Grouped, searchable multi-select over the project's available models.
 *
 * Shares `useModelSelectionOptions` with the single-select <ModelSelector>,
 * so the option set is always exactly the models the project's enabled
 * providers can serve — there is one source of truth for "what models exist
 * here", not two. Selection is a flat string[] of `provider/model` ids
 * (the shape `VirtualKey.config.modelsAllowed` stores and the gateway
 * enforces). Empty array = caller's convention for "all eligible models".
 */
export function ModelMultiSelect({
  value,
  onChange,
  mode = "chat",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  mode?: "chat" | "embedding";
}) {
  const { groupedByProvider, isLoading, isEmpty } = useModelSelectionOptions(
    allModelOptions,
    "",
    mode,
  );
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (modelValue: string) => {
    const next = new Set(selected);
    if (next.has(modelValue)) next.delete(modelValue);
    else next.add(modelValue);
    onChange([...next]);
  };

  const filteredGroups = useMemo(() => {
    const needle = search.toLowerCase();
    return groupedByProvider
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (m) =>
            m.label.toLowerCase().includes(needle) ||
            m.value.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [groupedByProvider, search]);

  if (isLoading) {
    return <Skeleton height="180px" borderRadius="md" />;
  }
  if (isEmpty) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No models available — configure a model provider first.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      <InputGroup startElement={<Search size={14} />}>
        <Input
          size="sm"
          placeholder="Search models"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>
      <Box
        maxHeight="240px"
        overflowY="auto"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        padding={2}
      >
        {filteredGroups.length === 0 ? (
          <Text fontSize="xs" color="fg.muted" padding={1}>
            No models match “{search}”.
          </Text>
        ) : (
          filteredGroups.map((group) => (
            <Box key={group.provider} mb={2}>
              <Text
                fontSize="xs"
                fontWeight="semibold"
                color="fg.muted"
                mb={1}
                paddingX={1}
              >
                {titleCase(group.provider)}
              </Text>
              <VStack align="stretch" gap={1}>
                {group.models.map((m) => (
                  <Checkbox
                    key={m.value}
                    size="sm"
                    checked={selected.has(m.value)}
                    onCheckedChange={() => toggle(m.value)}
                  >
                    <HStack gap={2}>
                      {m.icon && (
                        <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
                          {m.icon}
                        </Box>
                      )}
                      <Text fontSize="13px" fontFamily="mono">
                        {m.label}
                      </Text>
                    </HStack>
                  </Checkbox>
                ))}
              </VStack>
            </Box>
          ))
        )}
      </Box>
    </VStack>
  );
}
