/**
 * Evaluator Mapping Modal
 *
 * Modal for mapping evaluator inputs to dataset columns and agent outputs.
 */

import {
  Badge,
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuArrowRight, LuBrain, LuCode, LuDatabase } from "react-icons/lu";
import { Dialog } from "../../../../components/ui/dialog";
import { Select } from "../../../../components/ui/select";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import type { MappingSource } from "../../types";

type Props = {
  evaluatorId: string;
  onClose: () => void;
};

export function EvaluatorMappingModal({ evaluatorId, onClose }: Props) {
  const {
    evaluators,
    agents,
    dataset,
    evaluatorMappings,
    setEvaluatorInputMapping,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      evaluators: s.evaluators,
      agents: s.agents,
      dataset: s.dataset,
      evaluatorMappings: s.evaluatorMappings,
      setEvaluatorInputMapping: s.setEvaluatorInputMapping,
    }))
  );

  const evaluator = evaluators.find((e) => e.id === evaluatorId);
  const mapping = evaluatorMappings.find((m) => m.evaluatorId === evaluatorId);

  if (!evaluator) {
    return null;
  }

  // Build options from dataset columns and agent outputs
  const buildSourceOptions = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const options = [
      { label: "Not mapped", value: "", group: "" },
      // Dataset columns
      ...dataset.columns.map((col) => ({
        label: col.name,
        value: `dataset:${col.id}`,
        group: "Dataset",
      })),
    ];

    // Agent outputs
    if (agent) {
      options.push(
        ...agent.outputs.map((output) => ({
          label: `${agent.name} → ${output.identifier}`,
          value: `agent:${agent.id}:${output.identifier}`,
          group: "Agent Outputs",
        }))
      );
    }

    return options;
  };

  const getMappingValue = (agentId: string, inputId: string): string => {
    const source = mapping?.agentMappings[agentId]?.[inputId];
    if (!source) return "";
    if (source.type === "dataset") {
      return `dataset:${source.columnId}`;
    }
    if (source.type === "agent") {
      return `agent:${source.agentId}:${source.outputId}`;
    }
    return "";
  };

  const handleMappingChange = (
    agentId: string,
    inputId: string,
    value: string
  ) => {
    if (!value) {
      setEvaluatorInputMapping(evaluatorId, agentId, inputId, null);
      return;
    }

    const parts = value.split(":");
    if (parts[0] === "dataset" && parts[1]) {
      setEvaluatorInputMapping(evaluatorId, agentId, inputId, {
        type: "dataset",
        columnId: parts[1],
      });
    } else if (parts[0] === "agent" && parts[1] && parts[2]) {
      setEvaluatorInputMapping(evaluatorId, agentId, inputId, {
        type: "agent",
        agentId: parts[1],
        outputId: parts[2],
      });
    }
  };

  const getSourceIcon = (value: string) => {
    if (value.startsWith("dataset:")) {
      return <LuDatabase size={14} color="var(--chakra-colors-blue-500)" />;
    }
    if (value.startsWith("agent:")) {
      return <LuBrain size={14} color="var(--chakra-colors-purple-500)" />;
    }
    return null;
  };

  return (
    <Dialog.Root open={true} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content maxWidth="600px" maxHeight="80vh" overflow="auto">
        <Dialog.Header>
          <Dialog.Title>Map Inputs for {evaluator.name}</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>

        <Dialog.Body>
          <VStack gap={6} align="stretch">
            <Text fontSize="sm" color="gray.600">
              Connect evaluator inputs to dataset columns or agent outputs. When
              comparing multiple agents, configure mappings for each.
            </Text>

            {agents.length === 0 ? (
              <Text color="gray.500" textAlign="center" paddingY={4}>
                Add at least one agent first to configure mappings.
              </Text>
            ) : (
              agents.map((agent, agentIndex) => {
                const sourceOptions = buildSourceOptions(agent.id);
                const sourceCollection = createListCollection({
                  items: sourceOptions,
                });
                const AgentIcon = agent.type === "llm" ? LuBrain : LuCode;

                return (
                  <Box key={agent.id}>
                    {agents.length > 1 && (
                      <>
                        {agentIndex > 0 && <Separator marginY={4} />}
                        <HStack
                          gap={2}
                          marginBottom={3}
                          paddingBottom={2}
                          borderBottom="1px solid"
                          borderColor="gray.200"
                        >
                          <AgentIcon
                            size={16}
                            color="var(--chakra-colors-purple-500)"
                          />
                          <Text fontWeight="medium" color="purple.700">
                            Mappings for {agent.name}
                          </Text>
                        </HStack>
                      </>
                    )}

                    <VStack gap={3} align="stretch">
                      {evaluator.inputs.map((input) => {
                        const currentValue = getMappingValue(
                          agent.id,
                          input.identifier
                        );
                        const isRequired = !input.optional;
                        const isMapped = !!currentValue;

                        return (
                          <Field.Root key={`${agent.id}-${input.identifier}`}>
                            <HStack justify="space-between" marginBottom={1}>
                              <HStack gap={2}>
                                <Field.Label margin={0}>
                                  {input.identifier}
                                </Field.Label>
                                {isRequired && (
                                  <Badge
                                    colorPalette="red"
                                    size="sm"
                                    variant="subtle"
                                  >
                                    Required
                                  </Badge>
                                )}
                                {!isRequired && (
                                  <Badge
                                    colorPalette="gray"
                                    size="sm"
                                    variant="subtle"
                                  >
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
                                  handleMappingChange(
                                    agent.id,
                                    input.identifier,
                                    e.value[0] ?? ""
                                  )
                                }
                                width="full"
                              >
                                <Select.Trigger>
                                  <HStack gap={2}>
                                    {getSourceIcon(currentValue)}
                                    <Select.ValueText placeholder="Select source..." />
                                  </HStack>
                                </Select.Trigger>
                                <Select.Content>
                                  {sourceOptions.map((option) => (
                                    <Select.Item
                                      key={option.value || "empty"}
                                      item={option}
                                    >
                                      <HStack gap={2}>
                                        {getSourceIcon(option.value)}
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
                                background="green.50"
                                borderRadius="md"
                                minWidth="100px"
                              >
                                <Text
                                  fontSize="sm"
                                  color="green.700"
                                  fontWeight="medium"
                                >
                                  {input.identifier}
                                </Text>
                              </Box>
                            </HStack>
                          </Field.Root>
                        );
                      })}
                    </VStack>
                  </Box>
                );
              })
            )}

            {evaluator.inputs.length === 0 && (
              <Text color="gray.500" textAlign="center" paddingY={4}>
                This evaluator has no inputs to map.
              </Text>
            )}
          </VStack>
        </Dialog.Body>

        <Dialog.Footer>
          <Button colorPalette="green" onClick={onClose}>
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

