import { Box, VStack } from "@chakra-ui/react";
import { ResourceLimitRow } from "./ResourceLimitRow";
import type { PlanInfo } from "~/server/subscriptionHandler";

/** Resource keys that can be displayed in the limits component */
export type ResourceKey =
  | "members"
  | "membersLite"
  | "projects"
  | "prompts"
  | "workflows"
  | "scenarios"
  | "evaluators"
  | "messagesPerMonth"
  | "evaluationsCredit";

/** Display labels for each resource type */
export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  members: "Members",
  membersLite: "Members Lite",
  projects: "Projects",
  prompts: "Prompts",
  workflows: "Workflows",
  scenarios: "Scenarios",
  evaluators: "Evaluators",
  messagesPerMonth: "Messages/Month",
  evaluationsCredit: "Evaluations Credit",
} as const;

/** Ordered list of resource keys for consistent rendering */
const RESOURCE_ORDER: ResourceKey[] = [
  "members",
  "membersLite",
  "projects",
  "prompts",
  "workflows",
  "scenarios",
  "evaluators",
  "messagesPerMonth",
  "evaluationsCredit",
] as const;

export interface ResourceLimits {
  members: { current: number; max: number };
  membersLite: { current: number; max: number };
  projects: { current: number; max: number };
  prompts: { current: number; max: number };
  workflows: { current: number; max: number };
  scenarios: { current: number; max: number };
  evaluators: { current: number; max: number };
  messagesPerMonth: { current: number; max: number };
  evaluationsCredit: { current: number; max: number };
}

/** Input type for license status data with plan and resource counts */
interface LicenseStatusWithPlan {
  currentMembers: number;
  maxMembers: number;
  currentMembersLite: number;
  maxMembersLite: number;
  currentProjects: number;
  maxProjects: number;
  currentPrompts: number;
  maxPrompts: number;
  currentWorkflows: number;
  maxWorkflows: number;
  currentScenarios: number;
  maxScenarios: number;
  currentEvaluators: number;
  maxEvaluators: number;
  currentMessagesPerMonth: number;
  maxMessagesPerMonth: number;
  currentEvaluationsCredit: number;
  maxEvaluationsCredit: number;
}

/** Input type for usage data from the limits.getUsage query */
interface UsageData {
  membersCount: number;
  membersLiteCount: number;
  projectsCount: number;
  promptsCount: number;
  workflowsCount: number;
  scenariosCount: number;
  evaluatorsCount: number;
  currentMonthMessagesCount: number;
  evaluationsCreditUsed: number;
}

/**
 * Maps license status data to ResourceLimits format.
 * Used when displaying limits for organizations with a valid license.
 */
export function mapLicenseStatusToLimits(
  licenseData: LicenseStatusWithPlan
): ResourceLimits {
  return {
    members: { current: licenseData.currentMembers, max: licenseData.maxMembers },
    membersLite: { current: licenseData.currentMembersLite, max: licenseData.maxMembersLite },
    projects: { current: licenseData.currentProjects, max: licenseData.maxProjects },
    prompts: { current: licenseData.currentPrompts, max: licenseData.maxPrompts },
    workflows: { current: licenseData.currentWorkflows, max: licenseData.maxWorkflows },
    scenarios: { current: licenseData.currentScenarios, max: licenseData.maxScenarios },
    evaluators: { current: licenseData.currentEvaluators, max: licenseData.maxEvaluators },
    messagesPerMonth: { current: licenseData.currentMessagesPerMonth, max: licenseData.maxMessagesPerMonth },
    evaluationsCredit: { current: licenseData.currentEvaluationsCredit, max: licenseData.maxEvaluationsCredit },
  };
}

/**
 * Maps usage data to ResourceLimits format using a plan's limits.
 * Used when displaying limits for organizations without a license (free tier).
 */
export function mapUsageToLimits(
  usage: UsageData,
  plan: PlanInfo
): ResourceLimits {
  return {
    members: { current: usage.membersCount, max: plan.maxMembers },
    membersLite: { current: usage.membersLiteCount, max: plan.maxMembersLite },
    projects: { current: usage.projectsCount, max: plan.maxProjects },
    prompts: { current: usage.promptsCount, max: plan.maxPrompts },
    workflows: { current: usage.workflowsCount, max: plan.maxWorkflows },
    scenarios: { current: usage.scenariosCount, max: plan.maxScenarios },
    evaluators: { current: usage.evaluatorsCount, max: plan.maxEvaluators },
    messagesPerMonth: { current: usage.currentMonthMessagesCount, max: plan.maxMessagesPerMonth },
    evaluationsCredit: { current: usage.evaluationsCreditUsed, max: plan.evaluationsCredit },
  };
}

export interface ResourceLimitsDisplayProps {
  limits: ResourceLimits;
}

/**
 * Displays resource limits in a consistent format.
 * Used by both licensed plan and free tier sections on the usage page.
 */
export function ResourceLimitsDisplay({ limits }: ResourceLimitsDisplayProps) {
  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      padding={6}
      width="full"
      maxWidth="md"
    >
      <VStack align="start" gap={2}>
        {RESOURCE_ORDER.map((key) => (
          <ResourceLimitRow
            key={key}
            label={RESOURCE_LABELS[key]}
            current={limits[key].current}
            max={limits[key].max}
          />
        ))}
      </VStack>
    </Box>
  );
}
