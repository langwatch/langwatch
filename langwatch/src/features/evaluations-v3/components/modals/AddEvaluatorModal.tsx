/**
 * Add Evaluator Modal
 *
 * Modal for adding or editing an evaluator.
 */

import {
  Badge,
  Box,
  Button,
  Field,
  Grid,
  HStack,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { Dialog } from "../../../../components/ui/dialog";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import type { Evaluator, EvaluatorCategory } from "../../types";
import { nanoid } from "nanoid";
import { useAvailableEvaluators } from "../../../../hooks/useAvailableEvaluators";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "../../../../server/evaluations/evaluators.generated";

// Evaluator categories
const CATEGORIES: Array<{
  id: EvaluatorCategory;
  name: string;
  description: string;
}> = [
  {
    id: "expected_answer",
    name: "Expected Answer",
    description: "Compare output to expected result",
  },
  {
    id: "llm_judge",
    name: "LLM as Judge",
    description: "Use an LLM to evaluate output quality",
  },
  {
    id: "quality",
    name: "Quality",
    description: "Evaluate output quality metrics",
  },
  {
    id: "rag",
    name: "RAG",
    description: "Retrieval-augmented generation metrics",
  },
  {
    id: "safety",
    name: "Safety",
    description: "Check for harmful or unsafe content",
  },
  {
    id: "custom_evaluators",
    name: "Custom",
    description: "Your custom evaluators",
  },
];

type Props = {
  evaluatorId?: string;
  onClose: () => void;
};

export function AddEvaluatorModal({ evaluatorId, onClose }: Props) {
  const {
    evaluators,
    addEvaluator,
    updateEvaluator,
    removeEvaluator,
    autoMapEvaluator,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      evaluators: s.evaluators,
      addEvaluator: s.addEvaluator,
      updateEvaluator: s.updateEvaluator,
      removeEvaluator: s.removeEvaluator,
      autoMapEvaluator: s.autoMapEvaluator,
    }))
  );

  const availableEvaluators = useAvailableEvaluators();

  const existingEvaluator = evaluatorId
    ? evaluators.find((e) => e.id === evaluatorId)
    : null;
  const isEditing = !!existingEvaluator;

  const [step, setStep] = useState<"category" | "selection" | "settings">(
    isEditing ? "settings" : "category"
  );
  const [selectedCategory, setSelectedCategory] = useState<
    EvaluatorCategory | undefined
  >(existingEvaluator?.category);
  const [selectedType, setSelectedType] = useState<
    EvaluatorTypes | `custom/${string}` | undefined
  >(existingEvaluator?.type);
  const [settings, setSettings] = useState<Record<string, unknown>>(
    existingEvaluator?.settings ?? {}
  );

  // Get evaluators for selected category
  const evaluatorsForCategory = Object.entries(availableEvaluators ?? {})
    .filter(([_, def]) => {
      if (selectedCategory === "expected_answer") {
        return (
          def.category === "similarity" ||
          def.requiredFields.includes("expected_output")
        );
      }
      if (selectedCategory === "llm_judge") {
        return def.name?.toLowerCase().includes("llm") || def.name?.toLowerCase().includes("judge");
      }
      if (selectedCategory === "custom_evaluators") {
        return def.category === "custom";
      }
      return def.category === selectedCategory;
    })
    .map(([type, def]) => ({ type, ...def })) as Array<
    EvaluatorDefinition<EvaluatorTypes> & { type: string }
  >;

  const selectedEvaluatorDef = selectedType
    ? availableEvaluators?.[selectedType]
    : undefined;

  const handleCategorySelect = (category: EvaluatorCategory) => {
    setSelectedCategory(category);
    setStep("selection");
  };

  const handleEvaluatorSelect = (type: EvaluatorTypes | `custom/${string}`) => {
    setSelectedType(type);

    // Initialize settings with defaults
    const def = availableEvaluators?.[type];
    if (def?.settings) {
      const defaultSettings: Record<string, unknown> = {};
      for (const [key, setting] of Object.entries(def.settings)) {
        defaultSettings[key] = (setting as { default: unknown }).default;
      }
      setSettings(defaultSettings);
    }

    setStep("settings");
  };

  const handleSave = () => {
    if (!selectedType || !selectedEvaluatorDef || !selectedCategory) return;

    const id = existingEvaluator?.id ?? `evaluator_${nanoid(8)}`;

    // Build inputs from required and optional fields
    const inputs = [
      ...selectedEvaluatorDef.requiredFields.map((f) => ({
        identifier: f,
        type: "str" as const,
        optional: false,
      })),
      ...selectedEvaluatorDef.optionalFields.map((f) => ({
        identifier: f,
        type: "str" as const,
        optional: true,
      })),
    ];

    const evaluator: Evaluator = {
      id,
      type: selectedType,
      name: selectedEvaluatorDef.name,
      category: selectedCategory,
      settings,
      inputs,
    };

    if (isEditing) {
      updateEvaluator(id, evaluator);
    } else {
      addEvaluator(evaluator);
      // Auto-map after adding
      setTimeout(() => autoMapEvaluator(id), 0);
    }

    onClose();
  };

  const handleDelete = () => {
    if (
      evaluatorId &&
      confirm("Are you sure you want to delete this evaluator?")
    ) {
      removeEvaluator(evaluatorId);
      onClose();
    }
  };

  const renderCategoryStep = () => (
    <VStack gap={4} align="stretch">
      <Text fontSize="sm" color="gray.600">
        Choose a category of evaluator to add
      </Text>
      <RadioCard.Root
        variant="outline"
        colorPalette="green"
        value={selectedCategory}
        onValueChange={(e) => {
          if (e.value) {
            handleCategorySelect(e.value as EvaluatorCategory);
          }
        }}
      >
        <Grid gap={3}>
          {CATEGORIES.map((category) => (
            <RadioCard.Item
              key={category.id}
              value={category.id}
              cursor="pointer"
            >
              <RadioCard.ItemHiddenInput />
              <RadioCard.ItemControl>
                <RadioCard.ItemContent>
                  <RadioCard.ItemText fontWeight="medium">
                    {category.name}
                  </RadioCard.ItemText>
                  <RadioCard.ItemDescription>
                    {category.description}
                  </RadioCard.ItemDescription>
                </RadioCard.ItemContent>
                <RadioCard.ItemIndicator />
              </RadioCard.ItemControl>
            </RadioCard.Item>
          ))}
        </Grid>
      </RadioCard.Root>
    </VStack>
  );

  const renderSelectionStep = () => (
    <VStack gap={4} align="stretch">
      <HStack>
        <Button variant="ghost" size="sm" onClick={() => setStep("category")}>
          ← Back
        </Button>
        <Text fontSize="sm" color="gray.600">
          Choose an evaluator
        </Text>
      </HStack>

      {evaluatorsForCategory.length === 0 ? (
        <Text color="gray.500" textAlign="center" paddingY={8}>
          No evaluators available in this category
        </Text>
      ) : (
        <RadioCard.Root
          variant="outline"
          colorPalette="green"
          value={selectedType}
          onValueChange={(e) => {
            if (e.value) {
              handleEvaluatorSelect(e.value as EvaluatorTypes);
            }
          }}
        >
          <Grid gap={3}>
            {evaluatorsForCategory.map((evaluator) => (
              <RadioCard.Item
                key={evaluator.type}
                value={evaluator.type}
                cursor="pointer"
              >
                <RadioCard.ItemHiddenInput />
                <RadioCard.ItemControl>
                  <RadioCard.ItemContent>
                    <HStack>
                      <RadioCard.ItemText fontWeight="medium">
                        {evaluator.name}
                      </RadioCard.ItemText>
                      {evaluator.isGuardrail && (
                        <Badge colorPalette="blue" size="sm">
                          Guardrail
                        </Badge>
                      )}
                    </HStack>
                    <RadioCard.ItemDescription>
                      {evaluator.description}
                    </RadioCard.ItemDescription>
                  </RadioCard.ItemContent>
                  <RadioCard.ItemIndicator />
                </RadioCard.ItemControl>
              </RadioCard.Item>
            ))}
          </Grid>
        </RadioCard.Root>
      )}
    </VStack>
  );

  const renderSettingsStep = () => (
    <VStack gap={4} align="stretch">
      {!isEditing && (
        <HStack>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep("selection")}
          >
            ← Back
          </Button>
          <Text fontWeight="medium">{selectedEvaluatorDef?.name}</Text>
        </HStack>
      )}

      <Text fontSize="sm" color="gray.600">
        {selectedEvaluatorDef?.description}
      </Text>

      {/* Required fields info */}
      {selectedEvaluatorDef && (
        <Box
          background="gray.50"
          borderRadius="md"
          padding={3}
          border="1px solid"
          borderColor="gray.200"
        >
          <Text fontSize="xs" fontWeight="medium" color="gray.600" marginBottom={2}>
            Required Inputs
          </Text>
          <HStack gap={2} flexWrap="wrap">
            {selectedEvaluatorDef.requiredFields.map((field) => (
              <Badge key={field} colorPalette="blue" variant="subtle">
                {field}
              </Badge>
            ))}
            {selectedEvaluatorDef.optionalFields.map((field) => (
              <Badge key={field} colorPalette="gray" variant="subtle">
                {field} (optional)
              </Badge>
            ))}
          </HStack>
        </Box>
      )}

      {/* Settings */}
      {selectedEvaluatorDef?.settings &&
        Object.keys(selectedEvaluatorDef.settings).length > 0 && (
          <VStack gap={3} align="stretch">
            <Text fontSize="sm" fontWeight="medium">
              Settings
            </Text>
            {Object.entries(selectedEvaluatorDef.settings).map(
              ([key, setting]) => (
                <Field.Root key={key}>
                  <Field.Label>{key}</Field.Label>
                  <Field.HelperText>
                    {(setting as { description?: string }).description}
                  </Field.HelperText>
                  <Input
                    value={String(settings[key] ?? "")}
                    onChange={(e) =>
                      setSettings({ ...settings, [key]: e.target.value })
                    }
                    placeholder={String(
                      (setting as { default: unknown }).default
                    )}
                  />
                </Field.Root>
              )
            )}
          </VStack>
        )}
    </VStack>
  );

  return (
    <Dialog.Root open={true} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content maxWidth="500px">
        <Dialog.Header>
          <Dialog.Title>
            {isEditing ? "Edit Evaluator" : "Add Evaluator"}
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>

        <Dialog.Body>
          {step === "category" && renderCategoryStep()}
          {step === "selection" && renderSelectionStep()}
          {step === "settings" && renderSettingsStep()}
        </Dialog.Body>

        <Dialog.Footer>
          <HStack gap={2} width="full">
            {isEditing && (
              <Button
                variant="ghost"
                colorPalette="red"
                onClick={handleDelete}
              >
                <LuTrash2 size={14} />
                Delete
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
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

