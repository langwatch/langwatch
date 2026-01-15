import {
  Box,
  Button,
  Card,
  HStack,
  Icon,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
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
type ViewMode = "prompt" | "input";

export function ScenarioAIGeneration({ form }: ScenarioAIGenerationProps) {
  const { project } = useOrganizationTeamProject();
  const [viewMode, setViewMode] = useState<ViewMode>("prompt");
  const [input, setInput] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
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

  const hasHistory = promptHistory.length > 0;

  const handleGenerate = async () => {
    if (!input.trim() || !project?.id || !form) return;

    // Warn if form has content and no history (first generation)
    if (isFormDirty && !hasHistory) {
      const confirmed = window.confirm(
        "This will replace the current scenario content. Continue?"
      );
      if (!confirmed) return;
    }

    setStatus("generating");

    try {
      const currentScenario = hasHistory
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

      setPromptHistory((prev) => [...prev, input]);
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

  // "Prompt" view - initial state with CTA
  if (viewMode === "prompt") {
    return (
      <Card.Root>
        <Card.Body>
          <VStack align="stretch" gap={3}>
            <HStack gap={3}>
              <Box p={2} bg="blue.50" borderRadius="md" color="blue.500">
                <Icon as={Sparkles} boxSize={4} />
              </Box>
              <Text fontWeight="semibold" fontSize="sm">
                Need Help?
              </Text>
            </HStack>

            <Text fontSize="xs" color="gray.600">
              Let AI help you create a scenario. Describe your agent and the
              situation you want to test.
            </Text>

            <Button
              colorPalette="blue"
              size="sm"
              onClick={() => setViewMode("input")}
            >
              <Sparkles size={14} />
              Generate with AI
            </Button>
          </VStack>
        </Card.Body>
      </Card.Root>
    );
  }

  // "Input" view - AI generation interface
  return (
    <Card.Root>
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack justify="space-between">
            <HStack gap={3}>
              <Box p={2} bg="blue.50" borderRadius="md" color="blue.500">
                <Icon as={Sparkles} boxSize={4} />
              </Box>
              <Text fontWeight="semibold" fontSize="sm">
                AI Generation
              </Text>
            </HStack>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setViewMode("prompt")}
            >
              <ArrowLeft size={14} />
              Back
            </Button>
          </HStack>

          <Text fontSize="xs" color="gray.600">
            Describe what your agent does and the scenario you want to test.
          </Text>

          {isDefaultModelDisabled && (
            <AddModelProviderKey
              runWhat="generate scenarios"
              nodeProvidersWithoutCustomKeys={[providerName]}
            />
          )}

          {status === "done" && hasHistory && (
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

          {/* Prompt History - no truncation */}
          {hasHistory && (
            <VStack align="stretch" gap={1} fontSize="xs" color="gray.500">
              {promptHistory.map((prompt, index) => (
                <HStack key={index} align="start">
                  <Text flexShrink={0}>{">"}</Text>
                  <Text whiteSpace="pre-wrap">{prompt}</Text>
                </HStack>
              ))}
            </VStack>
          )}

          <Textarea
            placeholder={
              hasHistory
                ? "Refine: e.g., Add more edge cases about escalation"
                : "e.g., A customer support agent that handles refund requests. Test an angry customer who was charged twice."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter or Cmd/Ctrl+Enter to generate, Shift+Enter for new line
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                input.trim() &&
                status !== "generating" &&
                !isDefaultModelDisabled &&
                form
              ) {
                e.preventDefault();
                void handleGenerate();
              }
            }}
            disabled={status === "generating" || isDefaultModelDisabled}
            rows={5}
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
                {hasHistory ? "Refine" : "Generate"}
              </>
            )}
          </Button>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
