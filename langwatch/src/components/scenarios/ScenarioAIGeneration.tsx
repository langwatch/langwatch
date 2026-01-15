import {
  Box,
  Button,
  Card,
  Collapsible,
  HStack,
  Icon,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { AddModelProviderKey } from "../../optimization_studio/components/AddModelProviderKey";
import { DEFAULT_MODEL } from "../../utils/constants";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "../ModelSelector";
import { toaster } from "../ui/toaster";
import type { ScenarioFormData } from "./ScenarioForm";

type ScenarioAIGenerationProps = {
  form: UseFormReturn<ScenarioFormData> | null;
};

type GenerationStatus = "idle" | "generating" | "done" | "error";

export function ScenarioAIGeneration({ form }: ScenarioAIGenerationProps) {
  const { project } = useOrganizationTeamProject();
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("idle");

  // Check if the default model is enabled
  const defaultModel = project?.defaultModel ?? DEFAULT_MODEL;
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    defaultModel,
    "chat"
  );
  const isDefaultModelDisabled = modelOption?.isDisabled ?? false;
  const providerName = defaultModel.split("/")[0] ?? "unknown";

  const isFormDirty = form
    ? form.getValues("name") ||
      form.getValues("situation") ||
      form.getValues("criteria").length > 0
    : false;

  const handleGenerate = async () => {
    if (!input.trim() || !project?.id || !form) return;

    // Warn if form has content
    if (isFormDirty && !lastPrompt) {
      const confirmed = window.confirm(
        "This will replace the current scenario content. Continue?"
      );
      if (!confirmed) return;
    }

    setStatus("generating");

    try {
      const currentScenario = lastPrompt
        ? {
            name: form.getValues("name"),
            situation: form.getValues("situation"),
            criteria: form.getValues("criteria"),
            labels: form.getValues("labels"),
          }
        : null;

      const response = await fetch("/api/scenario/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: input,
          currentScenario,
          projectId: project.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate scenario");
      }

      const data = await response.json();
      const scenario = data.scenario;

      // Update form with generated data
      form.setValue("name", scenario.name);
      form.setValue("situation", scenario.situation);
      form.setValue("criteria", scenario.criteria);
      form.setValue("labels", scenario.labels);

      setLastPrompt(input);
      setInput("");
      setStatus("done");
    } catch (error) {
      console.error("Error generating scenario:", error);
      toaster.create({
        title: "Generation failed",
        description:
          error instanceof Error ? error.message : "An error occurred",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      setStatus("error");
    }
  };

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <Collapsible.Root open={isExpanded} onOpenChange={(e) => setIsExpanded(e.open)}>
          <Collapsible.Trigger asChild>
            <Button
              variant="ghost"
              width="full"
              justifyContent="space-between"
              padding={4}
              height="auto"
              _hover={{ bg: "gray.50" }}
            >
              <HStack gap={3}>
                <Box p={2} bg="blue.50" borderRadius="md" color="blue.500">
                  <Icon as={Sparkles} boxSize={4} />
                </Box>
                <Text fontWeight="semibold" fontSize="sm">
                  AI Generation
                </Text>
              </HStack>
              <Icon as={isExpanded ? ChevronUp : ChevronDown} />
            </Button>
          </Collapsible.Trigger>

          <Collapsible.Content>
            <VStack align="stretch" gap={3} padding={4} paddingTop={0}>
              <Text fontSize="xs" color="gray.600">
                Describe what your agent does and the scenario you want to test.
              </Text>

              {isDefaultModelDisabled && (
                <AddModelProviderKey
                  runWhat="generate scenarios"
                  nodeProvidersWithoutCustomKeys={[providerName]}
                />
              )}

              {lastPrompt && status === "done" && (
                <HStack
                  gap={2}
                  padding={2}
                  bg="green.50"
                  borderRadius="md"
                  fontSize="xs"
                  color="green.700"
                >
                  <Icon as={Check} boxSize={3} />
                  <Text>Generated! Review and edit the form on the left.</Text>
                </HStack>
              )}

              {lastPrompt && (
                <HStack fontSize="xs" color="gray.500">
                  <Text>{">"}</Text>
                  <Text lineClamp={1}>{lastPrompt}</Text>
                </HStack>
              )}

              <Textarea
                placeholder={
                  lastPrompt
                    ? "Refine: e.g., Add more edge cases about escalation"
                    : "e.g., A customer support agent that handles refund requests. Test an angry customer who was charged twice."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={status === "generating" || isDefaultModelDisabled}
                rows={3}
                fontSize="sm"
              />

              <Button
                colorPalette="blue"
                size="sm"
                onClick={handleGenerate}
                disabled={
                  !input.trim() ||
                  status === "generating" ||
                  isDefaultModelDisabled ||
                  !form
                }
              >
                {status === "generating" ? (
                  <>
                    <Spinner size="sm" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    {lastPrompt ? "Refine" : "Generate"}
                  </>
                )}
              </Button>
            </VStack>
          </Collapsible.Content>
        </Collapsible.Root>
      </Card.Body>
    </Card.Root>
  );
}
