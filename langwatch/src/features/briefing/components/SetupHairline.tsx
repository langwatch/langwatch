import {
  Box,
  chakra,
  Collapsible,
  Grid,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { LuCheck } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import {
  buildOnboardingSteps,
  calculateCompletionPercentage,
  type OnboardingStepKey,
  STEP_ICON,
} from "~/components/home/OnboardingProgress";

/**
 * The setup checklist, receded to a hairline.
 *
 * The first-run home leads with onboarding; a project WITH data does not, so
 * once the reader has activated, the checklist collapses to a single line that
 * never outranks the briefing. It stays one click from the full list — calm on
 * the hundredth visit, still reachable when they want to finish. Renders
 * nothing once every step is done.
 *
 * Deliberately NOT on Langy's skin: onboarding is a plain app-surface control,
 * so it sits below the briefing as a quiet, distinct footer rather than reading
 * as more of Langy. The accent is the app's own brand orange, not Langy's amber.
 */
export function SetupHairline() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  // Open by default: this card shares a row with the announcement note, so a
  // collapsed one-line bar would hang over dead space beside a taller
  // neighbour. Expanded, the remaining steps give the slot real content —
  // and "Hide" still collapses it for readers done looking at it.
  const [open, setOpen] = useState(true);

  const { data: checkStatus } = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  if (!project || !checkStatus) return null;

  const steps = buildOnboardingSteps(checkStatus, project.slug);
  const done = steps.filter((s) => s.complete).length;
  const percentage = calculateCompletionPercentage(steps);
  if (percentage === 100) return null;

  const remaining = steps.filter((s) => !s.complete);

  return (
    <Box width="full">
      <Collapsible.Root
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
      >
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="14px"
          background="bg.surface"
          overflow="hidden"
        >
          <Collapsible.Trigger asChild>
            <HStack
              as="button"
              width="full"
              gap={3}
              paddingX={4}
              paddingY={2.5}
              cursor="pointer"
              _hover={{ background: "bg.muted" }}
              transition="background 130ms ease"
            >
              <Box
                width="96px"
                height="5px"
                borderRadius="full"
                background="border.emphasized"
                overflow="hidden"
                flexShrink={0}
              >
                <Box
                  height="full"
                  width={`${percentage}%`}
                  background="orange.solid"
                />
              </Box>
              <Text fontFamily="mono" fontSize="12.5px" color="fg.muted">
                Setup · {done} of {steps.length} done
              </Text>
              <Text
                marginLeft="auto"
                fontFamily="mono"
                fontSize="12.5px"
                color="orange.fg"
              >
                {open ? "Hide" : "Finish setup"}
              </Text>
              <Box
                color="fg.subtle"
                transform={open ? "rotate(180deg)" : undefined}
                transition="transform 150ms ease"
              >
                <ChevronDown size={14} />
              </Box>
            </HStack>
          </Collapsible.Trigger>

          <Collapsible.Content>
            <VStack
              align="stretch"
              gap={0}
              paddingX={2}
              paddingTop={1.5}
              paddingBottom={2}
              borderTopWidth="1px"
              borderColor="border.muted"
            >
              {/* One column: the card lives in a half-width slot beside the
                  announcement note, so the steps stack as a short list. */}
              <Grid templateColumns="1fr" columnGap={2}>
                {remaining.map((step) => (
                  <SetupStepRow
                    key={step.key}
                    stepKey={step.key}
                    title={step.title}
                    onOpen={() => void router.push(step.href)}
                  />
                ))}
              </Grid>
              {done > 0 ? (
                <HStack gap={2} paddingX={2} paddingY={1.5} color="fg.subtle">
                  <LuCheck size={12} />
                  <Text fontSize="12px">{done} already done</Text>
                </HStack>
              ) : null}
            </VStack>
          </Collapsible.Content>
        </Box>
      </Collapsible.Root>
    </Box>
  );
}

/**
 * A setup step with a stable, single-row layout. It remains a direct route to
 * the setup surface — no hover-only controls are inserted ahead of its title,
 * so rows never jump or read like a second navigation layer.
 */
function SetupStepRow({
  stepKey,
  title,
  onOpen,
}: {
  stepKey: OnboardingStepKey;
  title: string;
  onOpen: () => void;
}) {
  const Icon = STEP_ICON[stepKey];

  return (
    <chakra.button
      type="button"
      onClick={onOpen}
      position="relative"
      display="flex"
      alignItems="center"
      gap={3}
      width="full"
      textAlign="left"
      paddingX={2.5}
      paddingY="7px"
      borderRadius="8px"
      cursor="pointer"
      transition="background 130ms ease"
      _hover={{ background: "bg.subtle" }}
      css={{
        "&:hover .step-check": {
          borderColor: "var(--chakra-colors-fg-muted)",
          color: "var(--chakra-colors-fg)",
        },
      }}
    >
      {/* A checkable circle carrying the step's icon — reads as a to-do you
          tick off, not a dead bullet. Fills to a check once the step is done
          (completed steps live in the "N already done" summary below). */}
      <Box
        className="step-check"
        position="relative"
        flexShrink={0}
        width="20px"
        height="20px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.emphasized"
        display="grid"
        placeItems="center"
        color="fg.subtle"
        transition="border-color 130ms ease, color 130ms ease"
      >
        <Icon size={11} />
      </Box>
      <Text position="relative" fontSize="13px" color="fg" flex={1}>
        {title}
      </Text>
    </chakra.button>
  );
}
