/**
 * Agent Mapping Modal
 *
 * Modal for mapping agent inputs to dataset columns.
 */

import {
  Badge,
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuArrowRight, LuDatabase } from "react-icons/lu";
import { Dialog } from "../../../../components/ui/dialog";
import { Select } from "../../../../components/ui/select";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import type { MappingSource } from "../../types";

type Props = {
  agentId: string;
  onClose: () => void;
};

export function AgentMappingModal({ agentId, onClose }: Props) {
  const {
    agents,
    dataset,
    agentMappings,
    setAgentInputMapping,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      agents: s.agents,
      dataset: s.dataset,
      agentMappings: s.agentMappings,
      setAgentInputMapping: s.setAgentInputMapping,
    }))
  );

  const agent = agents.find((a) => a.id === agentId);
  const mapping = agentMappings.find((m) => m.agentId === agentId);

  if (!agent) {
    return null;
  }

  // Build options from dataset columns
  const sourceOptions = [
    { label: "Not mapped", value: "" },
    ...dataset.columns.map((col) => ({
      label: col.name,
      value: `dataset:${col.id}`,
      group: "Dataset",
    })),
  ];

  const sourceCollection = createListCollection({
    items: sourceOptions,
  });

  const getMappingValue = (inputId: string): string => {
    const source = mapping?.inputMappings[inputId];
    if (!source) return "";
    if (source.type === "dataset") {
      return `dataset:${source.columnId}`;
    }
    return "";
  };

  const handleMappingChange = (inputId: string, value: string) => {
    if (!value) {
      setAgentInputMapping(agentId, inputId, null);
      return;
    }

    const [type, id] = value.split(":");
    if (type === "dataset" && id) {
      setAgentInputMapping(agentId, inputId, {
        type: "dataset",
        columnId: id,
      });
    }
  };

  return (
    <Dialog.Root open={true} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content maxWidth="500px">
        <Dialog.Header>
          <Dialog.Title>Map Inputs for {agent.name}</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>

        <Dialog.Body>
          <VStack gap={4} align="stretch">
            <Text fontSize="sm" color="gray.600">
              Connect each agent input to a column from your dataset.
            </Text>

            {agent.inputs.map((input) => {
              const currentValue = getMappingValue(input.identifier);
              const isRequired = !input.optional;
              const isMapped = !!currentValue;

              return (
                <Field.Root key={input.identifier}>
                  <HStack justify="space-between" marginBottom={1}>
                    <HStack gap={2}>
                      <Field.Label margin={0}>{input.identifier}</Field.Label>
                      {isRequired && (
                        <Badge colorPalette="red" size="sm" variant="subtle">
                          Required
                        </Badge>
                      )}
                      {!isRequired && (
                        <Badge colorPalette="gray" size="sm" variant="subtle">
                          Optional
                        </Badge>
                      )}
                    </HStack>
                    {isRequired && !isMapped && (
                      <Badge colorPalette="orange" size="sm">
                        Not mapped
                      </Badge>
                    )}
                  </HStack>

                  <HStack gap={2}>
                    <Select.Root
                      collection={sourceCollection}
                      value={currentValue ? [currentValue] : []}
                      onValueChange={(e) =>
                        handleMappingChange(input.identifier, e.value[0] ?? "")
                      }
                      width="full"
                    >
                      <Select.Trigger>
                        <HStack gap={2}>
                          {currentValue && (
                            <LuDatabase
                              size={14}
                              color="var(--chakra-colors-blue-500)"
                            />
                          )}
                          <Select.ValueText placeholder="Select source..." />
                        </HStack>
                      </Select.Trigger>
                      <Select.Content>
                        {sourceOptions.map((option) => (
                          <Select.Item key={option.value} item={option}>
                            <HStack gap={2}>
                              {option.value.startsWith("dataset:") && (
                                <LuDatabase size={14} />
                              )}
                              <Text>{option.label}</Text>
                            </HStack>
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>

                    <Box color="gray.400">
                      <LuArrowRight size={16} />
                    </Box>

                    <Box
                      paddingX={3}
                      paddingY={2}
                      background="purple.50"
                      borderRadius="md"
                      minWidth="100px"
                    >
                      <Text fontSize="sm" color="purple.700" fontWeight="medium">
                        {input.identifier}
                      </Text>
                    </Box>
                  </HStack>
                </Field.Root>
              );
            })}

            {agent.inputs.length === 0 && (
              <Text color="gray.500" textAlign="center" paddingY={4}>
                This agent has no inputs to map.
              </Text>
            )}
          </VStack>
        </Dialog.Body>

        <Dialog.Footer>
          <Button colorPalette="purple" onClick={onClose}>
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

