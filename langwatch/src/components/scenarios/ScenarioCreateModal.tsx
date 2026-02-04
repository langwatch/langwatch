import { useCallback } from "react";
import { AICreateModal, type ExampleTemplate } from "../shared/AICreateModal";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";
import { DEFAULT_MODEL } from "~/utils/constants";
import { allModelOptions, useModelSelectionOptions } from "../ModelSelector";
import { generateScenarioWithAI } from "./services/scenarioGeneration";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenarioCreateModalProps {
  /** Controls modal visibility */
  open: boolean;
  /** Called when modal is closed */
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODAL_TITLE = "Create new scenario";
const MODAL_PLACEHOLDER =
  "Explain your agent, its goals and what behavior you want to test.";
const GENERATING_TEXT = "Generating scenario...";
const DEFAULT_SCENARIO_NAME = "Untitled";

const EXAMPLE_TEMPLATES: ExampleTemplate[] = [
  {
    label: "Customer Support",
    text: "A customer support agent that handles complaints. Test an angry customer who was charged twice and wants a refund.",
  },
  {
    label: "RAG Q&A",
    text: "A knowledge bot that answers questions from documentation. Test a question that requires combining info from multiple sources.",
  },
  {
    label: "Tool-calling Agent",
    text: "An agent that uses tools to complete tasks. Test a request that requires calling multiple tools in sequence.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modal for creating a new scenario with AI assistance.
 *
 * Uses AICreateModal with scenario-specific configuration:
 * - onGenerate: Generates scenario with AI, creates it, then navigates to editor
 * - onSkip: Creates an empty scenario, then navigates to editor
 */
export function ScenarioCreateModal({ open, onClose }: ScenarioCreateModalProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useContext();

  // Check if any model providers are configured
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId: project?.id,
  });

  // Check if the default model has API keys configured
  const defaultModel = project?.defaultModel ?? DEFAULT_MODEL;
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    defaultModel,
    "chat"
  );
  const isModelDisabled = modelOption?.isDisabled ?? false;

  const createMutation = api.scenarios.create.useMutation({
    onSuccess: () => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const createScenario = useCallback(
    async (data: { name: string; situation: string; criteria: string[]; labels: string[] }) => {
      if (!project?.id) {
        throw new Error("No project selected");
      }

      return createMutation.mutateAsync({
        projectId: project.id,
        name: data.name || DEFAULT_SCENARIO_NAME,
        situation: data.situation || "",
        criteria: data.criteria || [],
        labels: data.labels || [],
      });
    },
    [project?.id, createMutation]
  );

  const handleGenerate = useCallback(
    async (description: string) => {
      if (!project?.id) {
        throw new Error("No project selected");
      }

      // Check if API keys are configured
      if (isModelDisabled) {
        throw new Error(
          "API keys not configured. Please go to Settings → Model Providers to add your API keys."
        );
      }

      // Generate scenario with AI
      const generatedData = await generateScenarioWithAI(description, project.id);

      // Create scenario with generated content
      const scenario = await createScenario(generatedData);

      // Navigate to editor
      openDrawer(
        "scenarioEditor",
        {
          urlParams: {
            scenarioId: scenario.id,
          },
        },
        { resetStack: true }
      );

      onClose();
    },
    [project?.id, isModelDisabled, createScenario, openDrawer, onClose]
  );

  const handleSkip = useCallback(async () => {
    try {
      const scenario = await createScenario({
        name: DEFAULT_SCENARIO_NAME,
        situation: "",
        criteria: [],
        labels: [],
      });

      // Navigate to editor
      openDrawer(
        "scenarioEditor",
        {
          urlParams: {
            scenarioId: scenario.id,
          },
        },
        { resetStack: true }
      );

      onClose();
    } catch (error) {
      toaster.create({
        title: "Failed to create scenario",
        description:
          error instanceof Error ? error.message : "An unexpected error occurred",
        type: "error",
        meta: { closable: true },
      });
    }
  }, [createScenario, openDrawer, onClose]);

  return (
    <AICreateModal
      open={open}
      onClose={onClose}
      title={MODAL_TITLE}
      placeholder={MODAL_PLACEHOLDER}
      exampleTemplates={EXAMPLE_TEMPLATES}
      onGenerate={handleGenerate}
      onSkip={handleSkip}
      generatingText={GENERATING_TEXT}
      hasModelProviders={hasEnabledProviders}
    />
  );
}
