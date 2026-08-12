import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check } from "lucide-react";
import {
  stepIsComplete,
  stepIsReachable,
  stepSummary,
  WIZARD_STEP_LABELS,
  WIZARD_STEPS,
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
  const draft = useDraft();
  const step = useWizardStep();
  const furthestStep = useFurthestWizardStep();
  const setStep = useAutomationStore((s) => s.setStep);

  return (
    <HStack
      as="nav"
      aria-label="Automation steps"
      gap={2}
      align="stretch"
      width="full"
    >
      {WIZARD_STEPS.map((candidate, index) => {
        const current = candidate === step;
        const reachable = stepIsReachable({ step: candidate, furthestStep });
        const complete = stepIsComplete({ step: candidate, draft });
        const summary = stepSummary({ step: candidate, draft, graphName });
        return (
          <Box
            key={candidate}
            as="button"
            type="button"
            flex="1"
            minWidth="0"
            textAlign="left"
            padding={2}
            borderRadius="md"
            borderWidth="1px"
            borderColor={current ? "colorPalette.emphasized" : "border"}
            bg={current ? "colorPalette.subtle" : "bg"}
            colorPalette="orange"
            opacity={reachable ? 1 : 0.55}
            cursor={reachable ? "pointer" : "not-allowed"}
            aria-current={current ? "step" : undefined}
            aria-disabled={!reachable || undefined}
            onClick={reachable ? () => setStep(candidate) : undefined}
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
                  {WIZARD_STEP_LABELS[candidate]}
                </Text>
                {complete && !current ? (
                  <Box as="span" color="green.solid" display="inline-flex">
                    <Check size={13} aria-hidden="true" />
                  </Box>
                ) : null}
              </HStack>
              {/* The current step is on screen in full, so its own summary
                  would only repeat what the author is looking at. */}
              {!current && summary ? (
                <Text textStyle="2xs" color="fg.muted" lineClamp={1}>
                  {summary}
                </Text>
              ) : null}
            </VStack>
          </Box>
        );
      })}
    </HStack>
  );
}
