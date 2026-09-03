/**
 * The AI Governance experience, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole section is one entry. What it exposes is a
 * loader per page rather than eleven components: the section is eight thousand
 * lines and the inventory page alone is three thousand, and a barrel of
 * components would put all of it in one chunk the moment any address under
 * /governance is opened. A loader keeps the split the application already had.
 *
 * The keys are this package's names for its own pages. Which URL each answers
 * is `apps/ui`'s to decide — the route table names a page key, the frontend
 * feature maps that key onto one of these, and neither half learns the other's
 * vocabulary.
 *
 * `governanceApi` and `GovernanceHostProvider` are the two things the owning
 * frontend feature has to mount around them: the tRPC Provider the screens'
 * hooks run on, and the port that answers for the session, the address, the
 * plan and the toasts.
 */

import type { ComponentType } from "react";

export type GovernanceScreenLoader = () => Promise<{ default: ComponentType }>;

export const governanceScreens = {
  overview: () => import("./governance-overview.screen"),
  inventory: () => import("./governance-inventory.screen"),
  ingestionSource: () => import("./governance-ingestion-source.screen"),
  anomalyRules: () => import("./governance-anomaly-rules.screen"),
  people: () => import("./governance-people.screen"),
  costs: () => import("./governance-costs.screen"),
  billed: () => import("./governance-billed.screen"),
  teams: () => import("./governance-teams.screen"),
  team: () => import("./governance-team.screen"),
  users: () => import("./governance-users.screen"),
  user: () => import("./governance-user.screen"),
} as const satisfies Record<string, GovernanceScreenLoader>;

export type GovernanceScreenName = keyof typeof governanceScreens;

export { governanceApi } from "../../behavior/governance-api";
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
} from "../../model/governance-host";
