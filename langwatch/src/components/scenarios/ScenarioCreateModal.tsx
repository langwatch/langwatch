import { useCallback } from "react";
import { AICreateModal, type ExampleTemplate } from "../shared/AICreateModal";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { generateScenarioWithAI } from "./services/scenarioGeneration";
import type { ScenarioFormData, ScenarioInitialData } from "./ScenarioForm";
import { getDefaultModelState } from "./utils/defaultModelState";

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
  const { hasEnabledProviders, providers } = useModelProvidersSettings({
    projectId: project?.id,
  });

  const defaultModelState = getDefaultModelState({
    hasEnabledProviders,
    providers,
    defaultModel: project?.defaultModel,
  });

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

      if (!defaultModelState.ok) {
        if (defaultModelState.reason === "no-default") {
          throw new Error(
            "No default model set. Configure one in Settings → Model Providers."
          );
        }
        if (defaultModelState.reason === "stale-default") {
          throw new Error(
            "Your default model's provider is disabled. Configure a new default in Settings → Model Providers."
          );
        }
        // no-providers: AICreateModal hides the Generate button, so this is unreachable in practice
        const _exhaustiveCheck: "no-providers" = defaultModelState.reason;
        void _exhaustiveCheck;
        return;
      }

      try {
        const generatedData = await generateScenarioWithAI(description, project.id);
        openEditorWithData(generatedData);
      } catch (error) {
        if (isHandledByGlobalHandler(error)) return;
        throw error;
      }
    },
    [project?.id, defaultModelState, openEditorWithData]
  );

  const handleSkip = useCallback(() => {
    openEditorWithData({
      name: "",
      situation: "",
      criteria: [],
    });
  }, [openEditorWithData]);

  const hasModelProviders = defaultModelState.ok || defaultModelState.reason !== "no-providers";

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
      hasModelProviders={hasModelProviders}
    />
  );
}
