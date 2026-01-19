import {
  Box,
  Grid,
  HStack,
  Progress,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useAnalytics } from "react-contextual-analytics";
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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { HomeCard } from "./HomeCard";

type OnboardingStepKey =
  | "createProject"
  | "syncFirstMessage"
  | "inviteTeamMembers"
  | "setupModelProviders"
  | "createPrompt"
  | "createSimulation"
  | "setupEvaluation"
  | "createWorkflow"
  | "createDataset";

type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  href: string;
  complete: boolean;
};

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

/**
 * Build onboarding steps from API response
 */
export const buildOnboardingSteps = (
  data: {
    workflows: number;
    datasets: number;
    evaluations: number;
    simulations: number;
    modelProviders: number;
    prompts: number;
    teamMembers: number;
    firstMessage: boolean;
  },
  projectSlug: string,
): OnboardingStep[] => {
  return [
    {
      key: "createProject",
      title: "Create your new project",
      href: "/settings/projects",
      complete: true,
    },
    {
      key: "syncFirstMessage",
      title: "Sync your first message",
      href: `/${projectSlug}/messages`,
      complete: data.firstMessage,
    },
    {
      key: "inviteTeamMembers",
      title: "Invite team members",
      href: `/settings/members`,
      complete: (data.teamMembers ?? 0) > 1,
    },
    {
      key: "setupModelProviders",
      title: "Setup your model providers",
      href: `/settings/model-providers`,
      complete: (data.modelProviders ?? 0) > 0,
    },
    {
      key: "createPrompt",
      title: "Create your first versioned prompt",
      href: `/${projectSlug}/prompts`,
      complete: (data.prompts ?? 0) > 0,
    },
    {
      key: "createSimulation",
      title: "Create your first agent simulation",
      href: `/${projectSlug}/simulations`,
      complete: (data.simulations ?? 0) > 0,
    },
    {
      key: "setupEvaluation",
      title: "Set up your first evaluation",
      href: `/${projectSlug}/evaluations`,
      complete: (data.evaluations ?? 0) > 0,
    },
    {
      key: "createWorkflow",
      title: "Create your first workflow",
      href: `/${projectSlug}/workflows`,
      complete: (data.workflows ?? 0) > 0,
    },
    {
      key: "createDataset",
      title: "Create a dataset from the messages",
      href: `/${projectSlug}/datasets`,
      complete: (data.datasets ?? 0) > 0,
    },
  ];
};

/**
 * Calculate completion percentage
 */
export const calculateCompletionPercentage = (
  steps: OnboardingStep[],
): number => {
  const completedCount = steps.filter((s) => s.complete).length;
  return Math.round((completedCount / steps.length) * 100);
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
      _hover={step.complete ? {} : { background: "gray.50" }}
      transition="all 0.15s"
    >
      <Box
        padding={1}
        borderRadius="full"
        background={step.complete ? "green.100" : "gray.100"}
        color={step.complete ? "green.600" : "gray.400"}
      >
        {step.complete ? <LuCheck size={10} /> : getIconForStep(step.key)}
      </Box>
      <Text
        fontSize="13px"
        color={step.complete ? "gray.400" : "gray.700"}
        textDecoration={step.complete ? "line-through" : "none"}
      >
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
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { emit } = useAnalytics();

  const { data: checkStatus, isLoading } =
    api.integrationsChecks.getCheckStatus.useQuery(
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

    emit("viewed", "onboarding_progress", {
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
      has_evaluations: (checkStatus.evaluations ?? 0) > 0,
      has_workflows: (checkStatus.workflows ?? 0) > 0,
      has_datasets: (checkStatus.datasets ?? 0) > 0,

      // Raw counts (for seeing actual usage depth)
      count_team_members: checkStatus.teamMembers ?? 0,
      count_model_providers: checkStatus.modelProviders ?? 0,
      count_prompts: checkStatus.prompts ?? 0,
      count_simulations: checkStatus.simulations ?? 0,
      count_evaluations: checkStatus.evaluations ?? 0,
      count_workflows: checkStatus.workflows ?? 0,
      count_datasets: checkStatus.datasets ?? 0,
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
    emit("clicked", "onboarding_step", {
      project_id: project.id,
      step_key: step.key,
      step_title: step.title,
      step_complete: step.complete,
    });
    void router.push(step.href);
  };

  // Split into columns of 3 max
  const columns: OnboardingStep[][] = [];
  for (let i = 0; i < steps.length; i += 3) {
    columns.push(steps.slice(i, i + 3));
  }

  return (
    <HomeCard
      cursor="default"
      width="full"
      padding={3}
      gap={2}
      _hover={{ boxShadow: "xs" }}
    >
      {/* Header with progress */}
      <HStack justify="space-between" align="center" width="full">
        <HStack gap={3}>
          <Text fontSize="sm" fontWeight="medium" color="gray.700">
            Get started with LangWatch
          </Text>
        </HStack>
        <Spacer />
        <Text fontSize="xs" color="gray.500">
          {completionPercentage}% completed
        </Text>
        <Box width="80px">
          <Progress.Root
            value={completionPercentage}
            colorPalette="orange"
            size="sm"
          >
            <Progress.Track borderRadius="full">
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        </Box>
      </HStack>

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
              <StepItem
                key={step.key}
                step={step}
                onClick={() => handleStepClick(step)}
              />
            ))}
          </VStack>
        ))}
      </Grid>
    </HomeCard>
  );
}
