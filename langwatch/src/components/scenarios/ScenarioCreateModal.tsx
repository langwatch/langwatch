import { useCallback } from "react";
import { AICreateModal, type ExampleTemplate } from "../shared/AICreateModal";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";

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
 * - onGenerate: Creates an empty scenario, then navigates to editor with initialPrompt
 * - onSkip: Creates an empty scenario, then navigates to editor without initialPrompt
 */
export function ScenarioCreateModal({ open, onClose }: ScenarioCreateModalProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useContext();

  const createMutation = api.scenarios.create.useMutation({
    onSuccess: () => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const createEmptyScenario = useCallback(async () => {
    if (!project?.id) {
      throw new Error("No project selected");
    }

    return createMutation.mutateAsync({
      projectId: project.id,
      name: DEFAULT_SCENARIO_NAME,
      situation: "",
      criteria: [],
      labels: [],
    });
  }, [project?.id, createMutation]);

  const handleGenerate = useCallback(
    async (description: string) => {
      const scenario = await createEmptyScenario();

      // Navigate to editor with initialPrompt
      openDrawer(
        "scenarioEditor",
        {
          urlParams: {
            scenarioId: scenario.id,
            initialPrompt: description,
          },
        },
        { resetStack: true }
      );

      onClose();
    },
    [createEmptyScenario, openDrawer, onClose]
  );

  const handleSkip = useCallback(async () => {
    try {
      const scenario = await createEmptyScenario();

      // Navigate to editor without initialPrompt
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
  }, [createEmptyScenario, openDrawer, onClose]);

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
    />
  );
}
