import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { AICreateModal, type ExampleTemplate } from "../../shared/AICreateModal";
import {
  type FanOutSeed,
  type FanOutTarget,
  generateAdjacentScenarios,
} from "../services/fanOutGeneration";

const MODAL_TITLE = "Find related failures";
const MODAL_PLACEHOLDER =
  "Describe what went wrong. What did the customer ask for, and how did the agent get it wrong?";
const GENERATING_TEXT = "Looking for related failures…";

const EXAMPLE_TEMPLATES: ExampleTemplate[] = [
  {
    label: "Refused a request",
    text: "Customers report the agent refuses to process refunds over $500, even when the policy allows it.",
  },
  {
    label: "Wrong information",
    text: "The agent quotes an outdated shipping time when asked about international delivery.",
  },
  {
    label: "Dropped context",
    text: "When a customer changes their order mid-conversation, the agent keeps working from the original one.",
  },
];

export interface AdjacentScenariosGenerateModalProps {
  open: boolean;
  onClose: () => void;
  /** Which agent/prompt the generated scenarios will run against. */
  target: FanOutTarget;
  /**
   * Pre-filled seed. Omit for the free-text path, where the description the
   * user types in this modal becomes the seed.
   */
  seed?: Exclude<FanOutSeed, { type: "FREE_TEXT" }>;
}

/**
 * Generates a batch of adjacent scenarios from a failure, then hands off to
 * the review drawer. Unlike single-scenario creation (which defers persistence
 * until Save), a batch persists immediately: it has a review/run/report
 * lifecycle that has to survive a page reload.
 *
 * See specs/scenarios/adjacent-scenario-generation.feature.
 */
export function AdjacentScenariosGenerateModal({
  open,
  onClose,
  target,
  seed,
}: AdjacentScenariosGenerateModalProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const handleGenerate = useCallback(
    async (description: string) => {
      if (!project?.id) throw new Error("No project selected");

      const result = await generateAdjacentScenarios({
        projectId: project.id,
        target,
        seed: seed ?? { type: "FREE_TEXT", description },
      });

      onClose();
      openDrawer(
        "adjacentScenariosReview",
        { urlParams: { batchId: result.batchId } },
        { resetStack: true },
      );
    },
    [project?.id, target, seed, onClose, openDrawer],
  );

  return (
    <AICreateModal
      open={open}
      onClose={onClose}
      title={MODAL_TITLE}
      placeholder={MODAL_PLACEHOLDER}
      exampleTemplates={seed ? [] : EXAMPLE_TEMPLATES}
      onGenerate={handleGenerate}
      onSkip={onClose}
      generatingText={GENERATING_TEXT}
      assistant={{
        name: "AI",
        description:
          "One failure usually means several. AI writes a handful of nearby cases so you can see how far it reaches.",
        promptLabel: "What went wrong?",
        generateLabel: "Find related failures",
        reviewHint:
          "You will review every scenario before any of them are kept or run.",
      }}
    />
  );
}
