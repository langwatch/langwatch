/**
 * Evaluator Settings Panel
 *
 * Side panel (drawer) for configuring evaluator settings and variable mapping.
 * Opens from the right side so users can see the spreadsheet while editing.
 */

import {
  Box,
  Button,
  Field,
  Grid,
  HStack,
  Input,
  NativeSelect,
  RadioCard,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import { LuArrowLeft, LuX } from "react-icons/lu";
import { Drawer, DrawerFooter } from "../../../../components/ui/drawer";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import type { Evaluator, MappingSource, EvaluatorCategory } from "../../types";
import { nanoid } from "nanoid";
import { useAvailableEvaluators } from "../../../../hooks/useAvailableEvaluators";
import { useEvaluatorCategories } from "../../../../components/evaluations/wizard/steps/evaluations/CategorySelectionAccordion";
import type { EvaluatorTypes } from "../../../../server/evaluations/evaluators.generated";

type Props = {
  evaluatorId?: string;
  isOpen: boolean;
  onClose: () => void;
};

type Step = "category" | "selection" | "settings";

export function EvaluatorSettingsPanel({ evaluatorId, isOpen, onClose }: Props) {
  const {
    evaluators,
    agents,
    dataset,
    evaluatorMappings,
    addEvaluator,
    updateEvaluator,
    removeEvaluator,
    setEvaluatorInputMapping,
    autoMapEvaluator,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      evaluators: s.evaluators,
      agents: s.agents,
      dataset: s.dataset,
      evaluatorMappings: s.evaluatorMappings,
      addEvaluator: s.addEvaluator,
      updateEvaluator: s.updateEvaluator,
      removeEvaluator: s.removeEvaluator,
      setEvaluatorInputMapping: s.setEvaluatorInputMapping,
      autoMapEvaluator: s.autoMapEvaluator,
    }))
  );

  const availableEvaluators = useAvailableEvaluators();
  const evaluatorCategories = useEvaluatorCategories();
  const existingEvaluator = evaluatorId ? evaluators.find((e) => e.id === evaluatorId) : null;
  const isEditing = !!existingEvaluator;

  const [step, setStep] = useState<Step>(isEditing ? "settings" : "category");
  const [selectedCategory, setSelectedCategory] = useState<EvaluatorCategory | null>(
    existingEvaluator?.category ?? null
  );
  const [selectedType, setSelectedType] = useState<string | null>(
    existingEvaluator?.type ?? null
  );
  const [name, setName] = useState(existingEvaluator?.name ?? "");
  const [settings, setSettings] = useState<Record<string, unknown>>(
    existingEvaluator?.settings ?? {}
  );

  // Get current mappings for this evaluator
  const currentMapping = evaluatorMappings.find((m) => m.evaluatorId === evaluatorId);

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      if (existingEvaluator) {
        setStep("settings");
        setSelectedCategory(existingEvaluator.category);
        setSelectedType(existingEvaluator.type);
        setName(existingEvaluator.name);
        setSettings(existingEvaluator.settings);
      } else {
        setStep("category");
        setSelectedCategory(null);
        setSelectedType(null);
        setName("");
        setSettings({});
      }
    }
  }, [isOpen, existingEvaluator]);

  // Get evaluators for selected category from the proper category definitions
  const categoryEvaluators = useMemo(() => {
    if (!selectedCategory) return [];

    const category = evaluatorCategories.find((c) => c.id === selectedCategory);
    if (!category) return [];

    return category.evaluators;
  }, [evaluatorCategories, selectedCategory]);

  // Get selected evaluator definition
  const selectedEvaluatorDef = useMemo(() => {
    if (!availableEvaluators || !selectedType) return null;
    return availableEvaluators[selectedType as EvaluatorTypes];
  }, [availableEvaluators, selectedType]);

  const handleCategorySelect = (category: EvaluatorCategory) => {
    setSelectedCategory(category);
    setStep("selection");
  };

  const handleEvaluatorSelect = (type: string) => {
    setSelectedType(type);
    const def = availableEvaluators?.[type as EvaluatorTypes];
    if (def) {
      setName(def.name);
      // Initialize default settings
      const defaultSettings: Record<string, unknown> = {};
      if (def.settings) {
        for (const [key, setting] of Object.entries(def.settings)) {
          const settingObj = setting as Record<string, unknown>;
          if ("default" in settingObj) {
            defaultSettings[key] = settingObj.default;
          }
        }
      }
      setSettings(defaultSettings);
    }
    setStep("settings");
  };

  const handleSave = () => {
    if (!selectedType || !selectedCategory) return;

    const newEvaluatorId = evaluatorId ?? nanoid();
    const evaluatorData: Evaluator = {
      id: newEvaluatorId,
      type: selectedType as Evaluator["type"],
      name: name || "Evaluator",
      category: selectedCategory,
      settings,
      inputs: selectedEvaluatorDef
        ? [
            ...selectedEvaluatorDef.requiredFields.map((f) => ({
              identifier: f,
              type: "str" as const,
            })),
            ...selectedEvaluatorDef.optionalFields.map((f) => ({
              identifier: f,
              type: "str" as const,
              optional: true,
            })),
          ]
        : [],
    };

    if (isEditing && evaluatorId) {
      updateEvaluator(evaluatorId, evaluatorData);
    } else {
      addEvaluator(evaluatorData);
      autoMapEvaluator(newEvaluatorId);
    }

    onClose();
  };

  const handleDelete = () => {
    if (evaluatorId) {
      removeEvaluator(evaluatorId);
      onClose();
    }
  };

  const handleMappingChange = (
    agentId: string,
    inputId: string,
    value: string
  ) => {
    if (!evaluatorId) return;

    let source: MappingSource | null = null;
    if (value.startsWith("dataset:")) {
      source = { type: "dataset", columnId: value.replace("dataset:", "") };
    } else if (value.startsWith("agent:")) {
      const [, aId, outputId] = value.split(":");
      if (aId && outputId) {
        source = { type: "agent", agentId: aId, outputId };
      }
    }

    setEvaluatorInputMapping(evaluatorId, agentId, inputId, source);
  };

  const handleBack = () => {
    if (step === "settings" && !isEditing) {
      setStep("selection");
    } else if (step === "selection") {
      setStep("category");
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      placement="end"
      size="md"
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <HStack gap={2}>
            {step !== "category" && !isEditing && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <LuArrowLeft size={16} />
              </Button>
            )}
            <Drawer.Title>
              {isEditing
                ? "Edit Evaluator"
                : step === "category"
                  ? "Choose Category"
                  : step === "selection"
                    ? "Select Evaluator"
                    : selectedEvaluatorDef?.name ?? "Configure Evaluator"}
            </Drawer.Title>
          </HStack>
          <Drawer.CloseTrigger asChild>
            <Button variant="ghost" size="sm" position="absolute" right={4} top={4}>
              <LuX />
            </Button>
          </Drawer.CloseTrigger>
        </Drawer.Header>
        <Drawer.Body>
          {step === "category" && (
            <VStack gap={3} align="stretch">
              <Text color="gray.600" fontSize="sm">
                Choose what aspect of your LLM you want to evaluate
              </Text>
              <RadioCard.Root
                variant="outline"
                colorPalette="green"
                value={selectedCategory ?? ""}
                onValueChange={(details: { value: string | null }) => {
                  if (details.value) {
                    handleCategorySelect(details.value as EvaluatorCategory);
                  }
                }}
              >
                <Grid gap={3}>
                  {evaluatorCategories.map((cat) => (
                    <RadioCard.Item
                      key={cat.id}
                      value={cat.id}
                      cursor="pointer"
                      onClick={() => handleCategorySelect(cat.id)}
                    >
                      <RadioCard.ItemHiddenInput />
                      <RadioCard.ItemControl>
                        <RadioCard.ItemIndicator />
                      </RadioCard.ItemControl>
                      <RadioCard.ItemContent>
                        <RadioCard.ItemText fontWeight="medium">
                          {cat.name}
                        </RadioCard.ItemText>
                        <RadioCard.ItemDescription>
                          {cat.description}
                        </RadioCard.ItemDescription>
                      </RadioCard.ItemContent>
                    </RadioCard.Item>
                  ))}
                </Grid>
              </RadioCard.Root>
            </VStack>
          )}

          {step === "selection" && (
            <VStack gap={3} align="stretch">
              <Text color="gray.600" fontSize="sm">
                Select an evaluator
              </Text>
              <RadioCard.Root
                variant="outline"
                colorPalette="green"
                value={selectedType ?? ""}
                onValueChange={(details: { value: string | null }) => {
                  if (details.value) {
                    handleEvaluatorSelect(details.value);
                  }
                }}
              >
                <Grid gap={3}>
                  {categoryEvaluators.map((evaluator) => (
                    <RadioCard.Item
                      key={evaluator.id}
                      value={evaluator.id}
                      cursor="pointer"
                      onClick={() => handleEvaluatorSelect(evaluator.id)}
                    >
                      <RadioCard.ItemHiddenInput />
                      <RadioCard.ItemControl>
                        <RadioCard.ItemIndicator />
                      </RadioCard.ItemControl>
                      <RadioCard.ItemContent>
                        <RadioCard.ItemText fontWeight="medium">
                          {evaluator.name}
                        </RadioCard.ItemText>
                        <RadioCard.ItemDescription>
                          {evaluator.description}
                        </RadioCard.ItemDescription>
                      </RadioCard.ItemContent>
                    </RadioCard.Item>
                  ))}
                </Grid>
              </RadioCard.Root>
            </VStack>
          )}

          {step === "settings" && selectedEvaluatorDef && (
            <VStack gap={6} align="stretch">
              {/* Description */}
              <Text color="gray.600" fontSize="sm">
                {selectedEvaluatorDef.description}
              </Text>

              {/* Required Inputs */}
              <Box
                padding={3}
                background="gray.50"
                borderRadius="md"
              >
                <Text fontSize="sm" fontWeight="medium" marginBottom={2}>
                  Required Inputs
                </Text>
                <HStack gap={2} flexWrap="wrap">
                  {selectedEvaluatorDef.requiredFields.map((field) => (
                    <Box
                      key={field}
                      paddingX={2}
                      paddingY={1}
                      background="gray.200"
                      borderRadius="md"
                      fontSize="sm"
                    >
                      {field}
                    </Box>
                  ))}
                  {selectedEvaluatorDef.optionalFields.map((field) => (
                    <Box
                      key={field}
                      paddingX={2}
                      paddingY={1}
                      background="gray.100"
                      borderRadius="md"
                      fontSize="sm"
                      color="gray.600"
                    >
                      {field} (optional)
                    </Box>
                  ))}
                </HStack>
              </Box>

              {/* Settings */}
              {selectedEvaluatorDef.settings &&
                Object.keys(selectedEvaluatorDef.settings).length > 0 && (
                  <>
                    <Separator />
                    <Text fontWeight="semibold" fontSize="sm">
                      Settings
                    </Text>
                    <VStack gap={4} align="stretch">
                      {Object.entries(selectedEvaluatorDef.settings).map(
                        ([key, setting]) => {
                          const settingObj = setting as Record<string, unknown>;
                          const description = settingObj.description ? String(settingObj.description) : null;
                          return (
                            <Field.Root key={key}>
                              <Field.Label>{key}</Field.Label>
                              {description && (
                                <Field.HelperText>
                                  {description}
                                </Field.HelperText>
                              )}
                              <Input
                                value={String(settings[key] ?? "")}
                                onChange={(e) =>
                                  setSettings({ ...settings, [key]: e.target.value })
                                }
                              />
                            </Field.Root>
                          );
                        }
                      )}
                    </VStack>
                  </>
                )}

              {/* Variable Mapping - Only for editing */}
              {isEditing && agents.length > 0 && (
                <>
                  <Separator />
                  <Text fontWeight="semibold" fontSize="sm">
                    Input Mapping
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Connect evaluator inputs to data sources
                  </Text>

                  {agents.map((agent) => (
                    <VStack key={agent.id} gap={3} align="stretch">
                      <Text fontSize="sm" fontWeight="medium" color="purple.700">
                        For {agent.name}:
                      </Text>
                      {[
                        ...selectedEvaluatorDef.requiredFields,
                        ...selectedEvaluatorDef.optionalFields,
                      ].map((inputId) => {
                        const currentValue =
                          currentMapping?.agentMappings?.[agent.id]?.[inputId];
                        let selectValue = "";
                        if (currentValue?.type === "dataset") {
                          selectValue = `dataset:${currentValue.columnId}`;
                        } else if (currentValue?.type === "agent") {
                          selectValue = `agent:${currentValue.agentId}:${currentValue.outputId}`;
                        }

                        const isOptional =
                          selectedEvaluatorDef.optionalFields.includes(inputId);

                        return (
                          <HStack key={inputId} gap={3}>
                            <Box
                              paddingX={3}
                              paddingY={2}
                              background="green.50"
                              borderRadius="md"
                              minWidth="140px"
                            >
                              <Text
                                fontSize="sm"
                                fontWeight="medium"
                                color="green.700"
                              >
                                {inputId}
                                {isOptional && (
                                  <Text as="span" color="green.500" fontWeight="normal">
                                    {" "}
                                    (opt)
                                  </Text>
                                )}
                              </Text>
                            </Box>
                            <Text color="gray.500">=</Text>
                            <NativeSelect.Root flex={1}>
                              <NativeSelect.Field
                                value={selectValue}
                                onChange={(e) =>
                                  handleMappingChange(agent.id, inputId, e.target.value)
                                }
                              >
                                <option value="">Select source...</option>
                                <optgroup label="Dataset Columns">
                                  {dataset.columns.map((col) => (
                                    <option
                                      key={col.id}
                                      value={`dataset:${col.id}`}
                                    >
                                      {col.name}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label={`${agent.name} Outputs`}>
                                  {agent.outputs.map((output) => (
                                    <option
                                      key={output.identifier}
                                      value={`agent:${agent.id}:${output.identifier}`}
                                    >
                                      {output.identifier}
                                    </option>
                                  ))}
                                </optgroup>
                              </NativeSelect.Field>
                              <NativeSelect.Indicator />
                            </NativeSelect.Root>
                          </HStack>
                        );
                      })}
                    </VStack>
                  ))}
                </>
              )}
            </VStack>
          )}
        </Drawer.Body>
        <DrawerFooter borderTopWidth="1px" gap={3}>
          {isEditing && (
            <Button variant="outline" colorPalette="red" onClick={handleDelete}>
              Delete Evaluator
            </Button>
          )}
          <Box flex={1} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {step === "settings" && (
            <Button colorPalette="green" onClick={handleSave}>
              {isEditing ? "Save Changes" : "Add Evaluator"}
            </Button>
          )}
        </DrawerFooter>
      </Drawer.Content>
    </Drawer.Root>
  );
}

