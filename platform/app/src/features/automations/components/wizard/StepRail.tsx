import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { Check } from "lucide-react";
import {
  stepIsComplete,
  stepIsReachable,
  stepSummary,
  WIZARD_STEP_LABELS,
  WIZARD_STEPS,
  type WizardStep,
} from "../../logic/wizardSteps";
import { useAutomationStore } from "../../state/automationStore";
import {
  useDraft,
  useFurthestWizardStep,
  useWizardStep,
} from "../../state/selectors";

/**
 * The persistent step rail (ADR-093 §4).
 *
 * The one measured failure of the previous restructuring attempt was losing
 * the overview while editing, so every step the author has reached keeps its
 * one-line summary on screen and stays one click away. That is also the direct
 * answer to ADR-037's objection to a stepper — no earlier choice is ever more
 * than a click away, and going back never discards a later answer, because the
 * draft holds every step's state at once.
 */
export function StepRail({ graphName }: { graphName?: string | null }) {
  const step = useWizardStep();
  const furthestStep = useFurthestWizardStep();

  return (
    <HStack
      as="nav"
      aria-label="Automation steps"
      gap={2}
      align="stretch"
      width="full"
    >
      {WIZARD_STEPS.map((candidate, index) => (
        <StepRailItem
          key={candidate}
          step={candidate}
          index={index}
          current={candidate === step}
          reachable={stepIsReachable({ step: candidate, furthestStep })}
          graphName={graphName}
        />
      ))}
    </HStack>
  );
}

/**
 * How a rail item looks and announces itself, given where the author is. Kept
 * out of the item so the two questions stay separate: this one is "what does
 * this state look like", the item's is "what does this step say".
 */
function railItemChrome({
  current,
  reachable,
}: {
  current: boolean;
  reachable: boolean;
}) {
  return {
    borderColor: current ? "colorPalette.emphasized" : "border",
    bg: current ? "colorPalette.subtle" : "bg",
    opacity: reachable ? 1 : 0.55,
    cursor: reachable ? "pointer" : "not-allowed",
    "aria-current": current ? ("step" as const) : undefined,
    "aria-disabled": !reachable || undefined,
  };
}

/** One step in the rail: its number and label, a check once it is answered,
 *  and — for a step the author is not looking at — the one line it decided. */
function StepRailItem({
  step,
  index,
  current,
  reachable,
  graphName,
}: {
  step: WizardStep;
  index: number;
  current: boolean;
  reachable: boolean;
  graphName?: string | null;
}) {
  const draft = useDraft();
  const setStep = useAutomationStore((s) => s.setStep);
  const complete = stepIsComplete({ step, draft });
  // The current step is on screen in full, so its own summary would only
  // repeat what the author is already looking at.
  const summary = current ? null : stepSummary({ step, draft, graphName });

  return (
    <chakra.button
      type="button"
      flex="1"
      minWidth="0"
      textAlign="left"
      padding={2}
      borderRadius="md"
      borderWidth="1px"
      colorPalette="orange"
      {...railItemChrome({ current, reachable })}
      onClick={reachable ? () => setStep(step) : undefined}
    >
      <VStack align="start" gap={0} minWidth="0" width="full">
        <HStack gap={1.5}>
          <Text
            textStyle="2xs"
            color="fg.muted"
            fontWeight="semibold"
            aria-hidden="true"
          >
            {index + 1}
          </Text>
          <Text textStyle="sm" fontWeight="semibold">
            {WIZARD_STEP_LABELS[step]}
          </Text>
          {complete && !current ? (
            <Box as="span" color="green.solid" display="inline-flex">
              <Check size={13} aria-hidden="true" />
            </Box>
          ) : null}
        </HStack>
        {summary ? (
          <Text textStyle="2xs" color="fg.muted" lineClamp={1}>
            {summary}
          </Text>
        ) : null}
      </VStack>
    </chakra.button>
  );
}
