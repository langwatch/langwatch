import { Box, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Check } from "lucide-react";

import {
  stepIsReachable,
  WIZARD_STEP_LABELS,
  WIZARD_STEPS,
  type WizardStep,
} from "../../model/wizard-steps.ts";

/**
 * The persistent step rail (ADR-093 §4): every step the author has reached
 * keeps its one-line summary on screen and stays one click away, so no earlier
 * choice is ever more than a click away and going back discards nothing.
 */
export function StepRail({
  step,
  furthestStep,
  isComplete,
  summaryOf,
  onSelect,
}: {
  step: WizardStep;
  furthestStep: WizardStep;
  isComplete: (step: WizardStep) => boolean;
  /** The one line a step decided; empty while it has nothing to say. */
  summaryOf: (step: WizardStep) => string;
  onSelect: (step: WizardStep) => void;
}) {
  return (
    <HStack as="nav" aria-label="Automation steps" gap={2} align="stretch" width="full">
      {WIZARD_STEPS.map((candidate, index) => {
        const isCurrent = candidate === step;
        const isReachable = stepIsReachable({ step: candidate, furthestStep });
        return (
          <StepRailItem
            key={candidate}
            step={candidate}
            index={index}
            isCurrent={isCurrent}
            isReachable={isReachable}
            isComplete={isComplete(candidate)}
            // The current step is on screen in full; its summary would repeat it.
            summary={isCurrent ? "" : summaryOf(candidate)}
            onSelect={isReachable ? () => onSelect(candidate) : undefined}
          />
        );
      })}
    </HStack>
  );
}

/** How a rail item looks and announces itself, given where the author is. */
function railItemChrome({ isCurrent, isReachable }: { isCurrent: boolean; isReachable: boolean }) {
  return {
    borderColor: isCurrent ? "colorPalette.emphasized" : "border",
    bg: isCurrent ? "colorPalette.subtle" : "bg",
    opacity: isReachable ? 1 : 0.55,
    cursor: isReachable ? "pointer" : "not-allowed",
    "aria-current": isCurrent ? ("step" as const) : undefined,
    "aria-disabled": !isReachable || undefined,
  };
}

/** One step: its number and label, a check once answered, and the line it decided. */
function StepRailItem({
  step,
  index,
  isCurrent,
  isReachable,
  isComplete,
  summary,
  onSelect,
}: {
  step: WizardStep;
  index: number;
  isCurrent: boolean;
  isReachable: boolean;
  isComplete: boolean;
  summary: string;
  onSelect: (() => void) | undefined;
}) {
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
      // Every item reserves the two-line height, so the rail never hops when
      // a step gains its first summary; a summary-less item centres its title.
      minHeight="52px"
      display="flex"
      alignItems="center"
      {...railItemChrome({ isCurrent, isReachable })}
      onClick={onSelect}
    >
      <VStack align="start" gap={0} minWidth="0" width="full">
        <HStack gap={1.5}>
          <Text textStyle="2xs" color="fg.muted" fontWeight="semibold" aria-hidden="true">
            {index + 1}
          </Text>
          <Text textStyle="sm" fontWeight="semibold">
            {WIZARD_STEP_LABELS[step]}
          </Text>
          {isComplete && !isCurrent ? (
            <Box as="span" color="green.solid" display="inline-flex">
              <Check size={13} aria-hidden="true" />
            </Box>
          ) : null}
        </HStack>
        {summary ? (
          <Text textStyle="2xs" color="fg.muted" lineClamp={1} width="full">
            {summary}
          </Text>
        ) : null}
      </VStack>
    </chakra.button>
  );
}
