import { SimpleGrid } from "@chakra-ui/react";
import { ResourceLimitRow } from "./ResourceLimitRow";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { LIMIT_TYPE_DISPLAY_LABELS } from "~/server/license-enforcement/constants";

/** Resource keys that can be displayed in the limits component */
export type ResourceKey =
  | "members"
  | "membersLite"
  | "teams"
  | "projects"
  | "prompts"
  | "workflows"
  | "scenarios"
  | "evaluators"
  | "agents"
  | "experiments"
  | "messagesPerMonth"
  | "eventsPerMonth"
  | "tracesPerMonth"
  | "evaluationsCredit";

/**
 * Display labels for each resource type.
 * Uses LIMIT_TYPE_DISPLAY_LABELS for core limit types, with additional
 * resource-specific labels that are used only in the usage display.
 */
export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  ...LIMIT_TYPE_DISPLAY_LABELS,
  membersLite: "Lite Members",
  // Default label is "Events / Month"; for TIERED orgs this is overridden
  // via the `messagesLabel` prop so they can display a different label
  // (e.g. "Traces / Month"). See ResourceLimitsDisplay component.
  messagesPerMonth: "Events / Month",
  // Label-only keys: not part of the ResourceLimits interface but included
  // here so that dynamic label resolution in usage.tsx (around line 109) can
  // look up a human-readable name for these resource types at runtime.
  eventsPerMonth: "Events / Month",
  tracesPerMonth: "Traces / Month",
  evaluationsCredit: "Evaluations Credit",
} as const;

/** Ordered list of resource keys for consistent rendering */
const RESOURCE_ORDER: (keyof ResourceLimits)[] = [
  "members",
  "membersLite",
  "messagesPerMonth",
] as const;

export interface ResourceLimits {
  members: { current: number; max: number };
  membersLite: { current: number; max: number };
  teams: { current: number; max: number };
  projects: { current: number; max: number };
  prompts: { current: number; max: number };
  workflows: { current: number; max: number };
  scenarios: { current: number; max: number };
  evaluators: { current: number; max: number };
  agents: { current: number; max: number };
  experiments: { current: number; max: number };
  messagesPerMonth: { current: number; max: number };
  evaluationsCredit: { current: number; max: number };
}

/** Input type for license status data with plan and resource counts */
interface LicenseStatusWithPlan {
  currentMembers: number;
  maxMembers: number;
  currentMembersLite: number;
  maxMembersLite: number;
  currentTeams: number;
  maxTeams: number;
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
  currentAgents: number;
  maxAgents: number;
  currentExperiments: number;
  maxExperiments: number;
  currentMessagesPerMonth: number;
  maxMessagesPerMonth: number;
  currentEvaluationsCredit: number;
  maxEvaluationsCredit: number;
}

/** Input type for usage data from the limits.getUsage query */
interface UsageData {
  membersCount: number;
  membersLiteCount: number;
  teamsCount: number;
  projectsCount: number;
  promptsCount: number;
  workflowsCount: number;
  scenariosCount: number;
  evaluatorsCount: number;
  agentsCount: number;
  experimentsCount: number;
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
    teams: { current: licenseData.currentTeams, max: licenseData.maxTeams },
    projects: { current: licenseData.currentProjects, max: licenseData.maxProjects },
    prompts: { current: licenseData.currentPrompts, max: licenseData.maxPrompts },
    workflows: { current: licenseData.currentWorkflows, max: licenseData.maxWorkflows },
    scenarios: { current: licenseData.currentScenarios, max: licenseData.maxScenarios },
    evaluators: { current: licenseData.currentEvaluators, max: licenseData.maxEvaluators },
    agents: { current: licenseData.currentAgents, max: licenseData.maxAgents },
    experiments: { current: licenseData.currentExperiments, max: licenseData.maxExperiments },
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
    teams: { current: usage.teamsCount, max: plan.maxTeams },
    projects: { current: usage.projectsCount, max: plan.maxProjects },
    prompts: { current: usage.promptsCount, max: plan.maxPrompts },
    workflows: { current: usage.workflowsCount, max: plan.maxWorkflows },
    scenarios: { current: usage.scenariosCount, max: plan.maxScenarios },
    evaluators: { current: usage.evaluatorsCount, max: plan.maxEvaluators },
    agents: { current: usage.agentsCount, max: plan.maxAgents },
    experiments: { current: usage.experimentsCount, max: plan.maxExperiments },
    messagesPerMonth: { current: usage.currentMonthMessagesCount, max: plan.maxMessagesPerMonth },
    evaluationsCredit: { current: usage.evaluationsCreditUsed, max: plan.evaluationsCredit },
  };
}

export interface ResourceLimitsDisplayProps {
  limits: ResourceLimits;
  /** When true, show "current / max" for member resources. Typically only for free plans. */
  showLimits?: boolean;
  /** Override label for the messagesPerMonth resource (e.g. "Traces / Month" for TIERED plans). */
  messagesLabel?: string;
  /** When true, show the Lite Members row. Only applies to SEAT_EVENT pricing model. */
  showLiteMembers?: boolean;
}

/**
 * Displays resource limits in a consistent format.
 * Used by both licensed plan and free tier sections on the usage page.
 */
export function ResourceLimitsDisplay({ limits, showLimits = false, messagesLabel, showLiteMembers = false }: ResourceLimitsDisplayProps) {
  const visibleKeys = showLiteMembers
    ? RESOURCE_ORDER
    : RESOURCE_ORDER.filter((key) => key !== "membersLite");

  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} width="full">
      {visibleKeys.map((key) => {
        const hideMax = !showLimits;
        const label = key === "messagesPerMonth" && messagesLabel ? messagesLabel : RESOURCE_LABELS[key];
        return (
          <ResourceLimitRow
            key={key}
            label={label}
            current={limits[key].current}
            max={hideMax ? undefined : limits[key].max}
          />
        );
      })}
    </SimpleGrid>
  );
}
