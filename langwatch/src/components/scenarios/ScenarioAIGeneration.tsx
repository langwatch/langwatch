import {
  Box,
  Button,
  Card,
  HStack,
  Icon,
  Link,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, ArrowLeft, Check, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { AddModelProviderKey } from "../../optimization_studio/components/AddModelProviderKey";
import { DEFAULT_MODEL } from "../../utils/constants";
import { createLogger } from "../../utils/logger";
import { allModelOptions, useModelSelectionOptions } from "../ModelSelector";
import { toaster } from "../ui/toaster";
import type { ScenarioFormData } from "./ScenarioForm";
import {
  generateScenarioWithAI,
  type GeneratedScenario,
} from "./services/scenarioGeneration";

const logger = createLogger("langwatch:scenarios:ai-generation");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ScenarioAIGenerationProps = {
  form: UseFormReturn<ScenarioFormData> | null;
};

export type GenerationStatus = "idle" | "generating" | "done" | "error";
type ViewMode = "prompt" | "input";

// Re-export for backwards compatibility
export type { GeneratedScenario } from "./services/scenarioGeneration";

// ─────────────────────────────────────────────────────────────────────────────
// Custom Hooks
// ─────────────────────────────────────────────────────────────────────────────

export function usePromptHistory() {
  const [history, setHistory] = useState<string[]>([]);

  const addPrompt = useCallback((prompt: string) => {
    setHistory((prev) => [...prev, prompt]);
  }, []);

  const hasHistory = history.length > 0;

  return { history, addPrompt, hasHistory };
}

export function useScenarioGeneration(projectId: string | undefined) {
  const [status, setStatus] = useState<GenerationStatus>("idle");

  const generate = useCallback(
    async (
      prompt: string,
      currentScenario: GeneratedScenario | null,
    ): Promise<GeneratedScenario> => {
      if (!projectId) {
        throw new Error("Project ID is required");
      }

      setStatus("generating");

      try {
        const scenario = await generateScenarioWithAI(
          prompt,
          projectId,
          currentScenario,
        );
        setStatus("done");
        return scenario;
      } catch (error) {
        setStatus("error");
        throw error;
      }
    },
    [projectId],
  );

  return { generate, status };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

export function formHasContent(form: UseFormReturn<ScenarioFormData>): boolean {
  const name = form.getValues("name").trim();
  const situation = form.getValues("situation").trim();
  const criteria = form.getValues("criteria");

  return name.length > 0 || situation.length > 0 || criteria.length > 0;
}

export function extractProviderFromModel(modelId: string): string {
  const PROVIDER_SEPARATOR = "/";
  const UNKNOWN_PROVIDER = "unknown";
  return modelId.split(PROVIDER_SEPARATOR)[0] ?? UNKNOWN_PROVIDER;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROMPT_INPUT_ROWS = 5;
const TOAST_DURATION_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ScenarioAIGeneration({ form }: ScenarioAIGenerationProps) {
  const { project } = useOrganizationTeamProject();

  const [viewMode, setViewMode] = useState<ViewMode>("prompt");
  const [input, setInput] = useState("");

  const { history, addPrompt, hasHistory } = usePromptHistory();
  const { generate, status } = useScenarioGeneration(project?.id);

  // Check if any model providers are configured
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId: project?.id,
  });

  // Check if the default model is enabled
  const defaultModel = project?.defaultModel ?? DEFAULT_MODEL;
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    defaultModel,
    "chat",
  );
  const isDefaultModelDisabled = modelOption?.isDisabled ?? false;
  const providerName = extractProviderFromModel(defaultModel);

  const hasExistingContent = form !== null && formHasContent(form);

  const canGenerate = Boolean(
    input.trim() && status !== "generating" && !isDefaultModelDisabled && form,
  );

  const handleGenerate = useCallback(async () => {
    if (!input.trim() || !project?.id || !form) return;

    // Warn if form has content and no history (first generation)
    if (hasExistingContent && !hasHistory) {
      const confirmed = window.confirm(
        "This will replace the current scenario content. Continue?",
      );
      if (!confirmed) return;
    }

    try {
      const currentScenario = hasHistory
        ? {
            name: form.getValues("name"),
            situation: form.getValues("situation"),
            criteria: form.getValues("criteria"),
          }
        : null;

      const scenario = await generate(input, currentScenario);

      // Update form with generated data (defensive defaults for unexpected API responses)
      form.setValue("name", scenario.name ?? "");
      form.setValue("situation", scenario.situation ?? "");
      form.setValue("criteria", scenario.criteria ?? []);

      addPrompt(input);
      setInput("");
    } catch (error) {
      logger.error({ error }, "Error generating scenario");
      toaster.create({
        title: "Generation failed",
        description:
          error instanceof Error ? error.message : "An error occurred",
        type: "error",
        duration: TOAST_DURATION_MS,
        meta: { closable: true },
      });
    }
  }, [
    input,
    project?.id,
    form,
    hasExistingContent,
    hasHistory,
    generate,
    addPrompt,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isSubmitKeyPress = e.key === "Enter" && !e.shiftKey;

      if (isSubmitKeyPress && canGenerate) {
        e.preventDefault();
        void handleGenerate();
      }
    },
    [canGenerate, handleGenerate],
  );

  // "Prompt" view - initial state with CTA
  if (viewMode === "prompt") {
    // Show warning when no model providers are configured
    if (!hasEnabledProviders) {
      return (
        <Card.Root>
          <Card.Body>
            <VStack align="stretch" gap={3}>
              <HStack gap={3}>
                <Box p={2} bg="orange.100" borderRadius="md" color="orange.600">
                  <Icon as={AlertTriangle} boxSize={4} />
                </Box>
                <Text fontWeight="semibold" fontSize="sm">
                  Model Provider Required
                </Text>
              </HStack>

              <Text fontSize="xs" color="fg.muted">
                Scenarios require a model provider to run.{" "}
                <Link
                  href="/settings/model-providers"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="blue.500"
                  fontWeight="medium"
                >
                  Configure model provider
                </Link>
              </Text>
            </VStack>
          </Card.Body>
        </Card.Root>
      );
    }

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

            <Text fontSize="xs" color="fg.muted">
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

          <Text fontSize="xs" color="fg.muted">
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
            <VStack align="stretch" gap={1} fontSize="xs" color="fg.muted">
              {history.map((prompt, index) => (
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
            onKeyDown={handleKeyDown}
            disabled={status === "generating" || isDefaultModelDisabled}
            rows={PROMPT_INPUT_ROWS}
            fontSize="sm"
          />

          <Button
            colorPalette="blue"
            size="sm"
            onClick={handleGenerate}
            disabled={!canGenerate}
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
