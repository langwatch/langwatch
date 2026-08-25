import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { AICreateModal, type ExampleTemplate } from "../shared/AICreateModal";
import { ModelProviderRequiredModal } from "./ModelProviderRequiredModal";
import { ResolvedModelCaption } from "./ResolvedModelCaption";
import type { ScenarioFormData, ScenarioInitialData } from "./ScenarioForm";
import type { ScenarioEditorVariant } from "./ScenarioFormDrawer";
import { generateScenarioWithAI } from "./services/scenarioGeneration";
import { storePromptForScenario } from "./services/scenarioPromptStorage";
import { getDefaultModelState } from "./utils/defaultModelState";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenarioCreateModalProps {
  /** Controls modal visibility */
  open: boolean;
  /** Called when modal is closed */
  onClose: () => void;
  /**
   * The test suite the new case is filed in. Absent leaves the case unfiled,
   * which is what every surface outside Agent Testing wants.
   */
  folderId?: string | null;
  /** Which editor the draft opens in. Absent opens the v1 editor. */
  variant?: ScenarioEditorVariant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODAL_TITLE = "Create new scenario";
/** What Agent Testing calls the same modal. */
const AGENT_TESTING_MODAL_TITLE = "New test case";
const MODAL_PLACEHOLDER =
  "Explain your agent, its goals and what behavior you want to test.";
const GENERATING_TEXT = "Drafting your scenario…";
const AGENT_TESTING_GENERATING_TEXT = "Drafting your test case…";
const PROMPT_LABEL = "What should this simulation prove?";
const AGENT_TESTING_PROMPT_LABEL = "What should this test case prove?";

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
export function ScenarioCreateModal({
  open,
  onClose,
  folderId,
  variant,
}: ScenarioCreateModalProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  // Check if any model providers are configured
  const { hasEnabledProviders, providers } = useModelProvidersSettings({
    projectId: project?.id,
  });

  // Cascade-resolved model for scenario generation.
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "scenarios.generator" },
    { enabled: !!project?.id },
  );

  const defaultModelState = getDefaultModelState({
    hasEnabledProviders,
    providers,
    defaultModel: resolvedDefault.data?.model,
  });

  const openEditorWithData = useCallback(
    (formData: Partial<ScenarioFormData>) => {
      const initialData: ScenarioInitialData = {
        initialFormData: folderId ? { ...formData, folderId } : formData,
      };
      openDrawer(
        "scenarioEditor",
        {
          ...initialData,
          ...(folderId ? { folderId } : {}),
          ...(variant ? { variant } : {}),
        },
        { resetStack: true },
      );
      onClose();
    },
    [openDrawer, onClose, folderId, variant],
  );

  const handleGenerate = useCallback(
    async (description: string) => {
      if (!project?.id) {
        throw new Error("No project selected");
      }

      try {
        const generatedData = await generateScenarioWithAI(
          description,
          project.id,
        );
        storePromptForScenario(description);
        openEditorWithData(generatedData);
      } catch (error) {
        if (isHandledByGlobalHandler(error)) return;
        throw error;
      }
    },
    [project?.id, openEditorWithData],
  );

  const handleSkip = useCallback(() => {
    openEditorWithData({
      name: "",
      situation: "",
      criteria: [],
    });
  }, [openEditorWithData]);

  if (!defaultModelState.ok) {
    return (
      <ModelProviderRequiredModal
        open={open}
        onClose={onClose}
        onProceedAnyway={handleSkip}
      />
    );
  }

  const isAgentTesting = variant === "agent-testing";

  return (
    <AICreateModal
      open={open}
      onClose={onClose}
      title={isAgentTesting ? AGENT_TESTING_MODAL_TITLE : MODAL_TITLE}
      placeholder={MODAL_PLACEHOLDER}
      exampleTemplates={EXAMPLE_TEMPLATES}
      onGenerate={(desc) => handleGenerate(desc)}
      onSkip={handleSkip}
      generatingText={
        isAgentTesting ? AGENT_TESTING_GENERATING_TEXT : GENERATING_TEXT
      }
      footerHint={<ResolvedModelCaption model={resolvedDefault.data?.model} />}
      assistant={{
        name: "AI",
        description:
          "Describe the behavior you care about. AI will turn it into an editable situation and success criteria.",
        promptLabel: isAgentTesting
          ? AGENT_TESTING_PROMPT_LABEL
          : PROMPT_LABEL,
        generateLabel: "Draft with AI",
        reviewHint:
          "AI is shaping the situation and criteria. You will review everything before it is saved.",
      }}
    />
  );
}
