import { useCallback } from "react";
import { AICreateModal, type ExampleTemplate } from "../shared/AICreateModal";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { isHandledByGlobalLicenseHandler } from "~/utils/trpcError";
import { DEFAULT_MODEL } from "~/utils/constants";
import { allModelOptions, useModelSelectionOptions } from "../ModelSelector";
import { generateScenarioWithAI } from "./services/scenarioGeneration";
import type { ScenarioFormData, ScenarioInitialData } from "./ScenarioForm";

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
 * Opens the ScenarioFormDrawer with initial data via complexProps.
 * No DB record is created until the user clicks "Save" in the drawer.
 */
export function ScenarioCreateModal({ open, onClose }: ScenarioCreateModalProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const { checkAndProceed } = useLicenseEnforcement("scenarios");

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

  const openEditorWithData = useCallback(
    (formData: Partial<ScenarioFormData>) => {
      const initialData: ScenarioInitialData = { initialFormData: formData };
      openDrawer(
        "scenarioEditor",
        {
          ...initialData,
        },
        { resetStack: true }
      );
      onClose();
    },
    [openDrawer, onClose]
  );

  const handleGenerate = useCallback(
    async (description: string) => {
      if (!project?.id) {
        throw new Error("No project selected");
      }

      if (isModelDisabled) {
        throw new Error(
          "API keys not configured. Please go to Settings → Model Providers to add your API keys."
        );
      }

      try {
        const generatedData = await generateScenarioWithAI(description, project.id);
        openEditorWithData(generatedData);
      } catch (error) {
        if (isHandledByGlobalLicenseHandler(error)) return;
        throw error;
      }
    },
    [project?.id, isModelDisabled, openEditorWithData]
  );

  const handleSkip = useCallback(() => {
    openEditorWithData({
      name: "",
      situation: "",
      criteria: [],
      labels: [],
    });
  }, [openEditorWithData]);

  return (
    <AICreateModal
      open={open}
      onClose={onClose}
      title={MODAL_TITLE}
      placeholder={MODAL_PLACEHOLDER}
      exampleTemplates={EXAMPLE_TEMPLATES}
      onGenerate={(desc) => checkAndProceed(() => handleGenerate(desc))}
      onSkip={() => checkAndProceed(handleSkip)}
      generatingText={GENERATING_TEXT}
      hasModelProviders={hasEnabledProviders}
    />
  );
}
