/** AI governance screens as loaders, keyed by page name; mount with GovernanceHostProvider. */

import type { ComponentType } from "react";

export type GovernanceScreenLoader = () => Promise<{ default: ComponentType }>;

export const governanceScreens = {
  overview: () => import("./ui/sections/governance/governance-overview.screen.tsx"),
  inventory: () => import("./ui/sections/governance/governance-inventory.screen.tsx"),
  ingestionSource: () => import("./ui/sections/governance/governance-ingestion-source.screen.tsx"),
  anomalyRules: () => import("./ui/sections/governance/governance-anomaly-rules.screen.tsx"),
  people: () => import("./ui/sections/governance/governance-people.screen.tsx"),
  agents: () => import("./ui/sections/governance/agents.tsx"),
  costs: () => import("./ui/sections/governance/governance-costs.screen.tsx"),
  billed: () => import("./ui/sections/governance/governance-billed.screen.tsx"),
  insights: () => import("./ui/sections/governance/insights.tsx"),
  analytics: () => import("./ui/sections/governance/analytics.tsx"),
  signals: () => import("./ui/sections/governance/signals.tsx"),
  teams: () => import("./ui/sections/governance/governance-teams.screen.tsx"),
  team: () => import("./ui/sections/governance/governance-team.screen.tsx"),
  users: () => import("./ui/sections/governance/governance-users.screen.tsx"),
  user: () => import("./ui/sections/governance/governance-user.screen.tsx"),
} as const satisfies Record<string, GovernanceScreenLoader>;

export type GovernanceScreenName = keyof typeof governanceScreens;

export { governanceApi } from "./behavior/governance-api.ts";
export {
  GovernanceHostPort,
  GovernanceHostProvider,
  type GovernanceDeployment,
  type GovernanceFailureNotice,
  type GovernanceOrganization,
  type GovernancePlan,
  type GovernanceProject,
  type GovernanceRouteReading,
  type GovernanceScope,
  type GovernanceSuccessNotice,
  type GovernanceTeam,
} from "./model/governance-host.ts";
