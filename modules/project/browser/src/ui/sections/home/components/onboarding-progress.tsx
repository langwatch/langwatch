import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { Box, Button, Grid, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";
import {
  LuCheck,
  LuDatabase,
  LuGauge,
  LuKey,
  LuMessageSquare,
  LuPlay,
  LuScroll,
  LuUsers,
  LuWorkflow,
} from "react-icons/lu";

import { homeApi } from "../../../../behavior/home-api.ts";
import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
import { HomeCard } from "./home-card.tsx";
import { HomeSectionHeader } from "./home-section-header.tsx";
import { HOME_SECTION_GAP, HOME_SECTION_PADDING } from "./home-section-layout.ts";
import {
  buildOnboardingSteps,
  calculateCompletionPercentage,
  type OnboardingStep,
  type OnboardingStepKey,
} from "./onboarding-progress.model.ts";

/**
 * Get icon for onboarding step
 */
const getIconForStep = (key: OnboardingStepKey) => {
  switch (key) {
    case "createProject":
      return <LuCheck size={12} />;
    case "syncFirstMessage":
      return <LuMessageSquare size={12} />;
    case "inviteTeamMembers":
      return <LuUsers size={12} />;
    case "setupModelProviders":
      return <LuKey size={12} />;
    case "createPrompt":
      return <LuScroll size={12} />;
    case "createWorkflow":
      return <LuWorkflow size={12} />;
    case "createSimulation":
      return <LuPlay size={12} />;
    case "setupEvaluation":
      return <LuGauge size={12} />;
    case "createDataset":
      return <LuDatabase size={12} />;
    default:
      return <LuCheck size={12} />;
  }
};

type StepItemProps = {
  step: OnboardingStep;
  onClick: () => void;
};

/**
 * Single step item in the onboarding progress
 */
function StepItem({ step, onClick }: StepItemProps) {
  return (
    <HStack
      gap={2}
      paddingY={1}
      paddingX={1}
      borderRadius="md"
      cursor={step.complete ? "default" : "pointer"}
      onClick={step.complete ? undefined : onClick}
      _hover={step.complete ? {} : { background: "bg.muted" }}
      transition="all 0.15s"
    >
      <Box
        padding={1}
        borderRadius="full"
        background={step.complete ? "green.subtle" : "bg.muted"}
        color={step.complete ? "green.fg" : "fg.muted"}
      >
        {step.complete ? <LuCheck size={10} /> : getIconForStep(step.key)}
      </Box>
      <Text textStyle="bodySm" color={step.complete ? "fg.muted" : "fg"}>
        {step.title}
      </Text>
    </HStack>
  );
}

/**
 * OnboardingProgress
 * Shows onboarding steps completion status in columns.
 * Hides when all steps are complete.
 */
export function OnboardingProgress() {
  const navigate = useProjectHomeHost().navigate.bind(useProjectHomeHost());
  const project = useProjectHomeHost().project();
  const analytics = useUiAnalytics();
  const [showCompleted, setShowCompleted] = useState(false);

  const { data: checkStatus, isLoading } = homeApi.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  // Track onboarding status when data first loads
  // Using isLoading as trigger - tracks once when loading completes
  useEffect(() => {
    if (isLoading || !checkStatus || !project?.id) return;

    const steps = buildOnboardingSteps(checkStatus, project.slug);
    const completedSteps = steps.filter((s) => s.complete);
    const completionPercentage = calculateCompletionPercentage(steps);

    analytics.track({
      action: "viewed",
      name: "onboarding_progress",
      attributes: {
        // Use project_id as the grouping dimension
        project_id: project.id,

        // Overall metrics
        completion_percentage: completionPercentage,
        completed_tasks_count: completedSteps.length,
        total_tasks_count: steps.length,
        all_complete: completionPercentage === 100,

        // Individual task completion (booleans for filtering)
        has_first_message: checkStatus.firstMessage,
        has_team_members: (checkStatus.teamMembers ?? 0) > 1,
        has_model_providers: (checkStatus.modelProviders ?? 0) > 0,
        has_prompts: (checkStatus.prompts ?? 0) > 0,
        has_simulations: (checkStatus.simulations ?? 0) > 0,
        has_online_evaluations: (checkStatus.onlineEvaluations ?? 0) > 0,
        has_workflows: (checkStatus.workflows ?? 0) > 0,
        has_datasets: (checkStatus.datasets ?? 0) > 0,

        // Raw counts (for seeing actual usage depth)
        count_team_members: checkStatus.teamMembers ?? 0,
        count_model_providers: checkStatus.modelProviders ?? 0,
        count_prompts: checkStatus.prompts ?? 0,
        count_simulations: checkStatus.simulations ?? 0,
        count_online_evaluations: checkStatus.onlineEvaluations ?? 0,
        count_workflows: checkStatus.workflows ?? 0,
        count_datasets: checkStatus.datasets ?? 0,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  if (isLoading || !checkStatus || !project) {
    return null;
  }

  const steps = buildOnboardingSteps(checkStatus, project.slug);
  const completionPercentage = calculateCompletionPercentage(steps);
  const allComplete = completionPercentage === 100;

  if (allComplete) {
    return null;
  }

  const handleStepClick = (step: OnboardingStep) => {
    analytics.track({
      action: "clicked",
      name: "onboarding_step",
      attributes: {
        project_id: project.id,
        step_key: step.key,
        step_title: step.title,
        step_complete: step.complete,
      },
    });
    navigate(step.href);
  };

  const shownSteps = showCompleted ? steps : steps.filter((s) => !s.complete);
  const columns: OnboardingStep[][] = [];
  for (let i = 0; i < shownSteps.length; i += 3) {
    columns.push(shownSteps.slice(i, i + 3));
  }

  return (
    <HomeCard cursor="default" width="full" padding={HOME_SECTION_PADDING} gap={HOME_SECTION_GAP}>
      <HomeSectionHeader
        title="Get started with LangWatch"
        qualifier={`${steps.filter((s) => s.complete).length} of ${steps.length}`}
      >
        <Button size="xs" variant="ghost" onClick={() => setShowCompleted(!showCompleted)}>
          {showCompleted ? "Hide completed" : "Show completed"}
        </Button>
      </HomeSectionHeader>

      {/* Steps in columns */}
      <Grid
        templateColumns={{
          base: "1fr",
          md: `repeat(${columns.length}, 1fr)`,
        }}
        gap={2}
        width="full"
      >
        {columns.map((column, colIndex) => (
          <VStack key={colIndex} align="stretch" gap={0}>
            {column.map((step) => (
              <StepItem key={step.key} step={step} onClick={() => handleStepClick(step)} />
            ))}
          </VStack>
        ))}
      </Grid>
    </HomeCard>
  );
}
