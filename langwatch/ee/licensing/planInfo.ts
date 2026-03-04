/**
 * PlanInfo type definition - isolated to avoid circular dependencies.
 *
 * This type is used by both ee/licensing and src/server code.
 * Keeping it in a separate file prevents webpack from bundling
 * server-side code when client components import from ee/licensing.
 */
export type PlanInfo = {
  planSource: "license" | "subscription" | "free";
  type: string;
  name: string;
  free: boolean;
  trialDays?: number;
  daysSinceCreation?: number;
  overrideAddingLimitations?: boolean;
  maxMembers: number;
  maxMembersLite: number;
  maxTeams: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  maxWorkflows: number;
  maxPrompts: number;
  maxEvaluators: number;
  maxScenarios: number;
  maxAgents: number;
  maxExperiments: number;
  maxOnlineEvaluations: number;
  maxDatasets: number;
  maxDashboards: number;
  maxCustomGraphs: number;
  maxAutomations: number;
  canPublish: boolean;
  usageUnit?: string;
  userPrice?: {
    USD: number;
    EUR: number;
  };
  tracesPrice?: {
    USD: number;
    EUR: number;
  };
  prices: {
    USD: number;
    EUR: number;
  };
};
