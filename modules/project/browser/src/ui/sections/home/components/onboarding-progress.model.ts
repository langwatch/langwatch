import type { IconType } from "react-icons";
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

export type OnboardingStepKey =
  | "createProject"
  | "syncFirstMessage"
  | "inviteTeamMembers"
  | "setupModelProviders"
  | "createPrompt"
  | "createSimulation"
  | "setupEvaluation"
  | "createWorkflow"
  | "createDataset";

/** The icon for each step, shared with the receded setup hairline. */
export const STEP_ICON: Record<OnboardingStepKey, IconType> = {
  createProject: LuCheck,
  syncFirstMessage: LuMessageSquare,
  inviteTeamMembers: LuUsers,
  setupModelProviders: LuKey,
  createPrompt: LuScroll,
  createSimulation: LuPlay,
  setupEvaluation: LuGauge,
  createWorkflow: LuWorkflow,
  createDataset: LuDatabase,
};

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  href: string;
  complete: boolean;
};

/**
 * Build onboarding steps from API response
 */
export const buildOnboardingSteps = (
  data: {
    workflows: number;
    datasets: number;
    onlineEvaluations: number;
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
      href: "/settings/teams",
      complete: true,
    },
    {
      key: "syncFirstMessage",
      title: "Sync your first message",
      href: `/${projectSlug}/traces`,
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
      title: "Set up your model providers",
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
      title: "Set up your first online evaluation",
      href: `/${projectSlug}/online-evaluations`,
      complete: (data.onlineEvaluations ?? 0) > 0,
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
export const calculateCompletionPercentage = (steps: OnboardingStep[]): number => {
  const completedCount = steps.filter((s) => s.complete).length;
  return Math.round((completedCount / steps.length) * 100);
};
