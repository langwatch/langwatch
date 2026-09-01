/**
 * The personal workspace, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes is a
 * loader per page rather than seven components: two of these screens carry a
 * table of their own and a third carries the whole tools portal, and a barrel of
 * components would put all of it in one chunk the moment any of the seven
 * addresses is opened. A loader keeps the split the application already had.
 *
 * The keys are this package's names for its own pages. Which URL each answers
 * is `apps/ui`'s to decide — the route table names a page key, the frontend
 * feature maps that key onto one of these, and neither half learns the other's
 * vocabulary. `/me/devices` is not here: it is a redirect row in the route
 * table, which is what a path that only ever went somewhere else should be.
 *
 * TWO OF THE SEVEN ARE PROJECT-SCOPED, not personal, and that is deliberate.
 * `/:project/sessions` and `/:project/pull-requests` had 52- and 63-line page
 * files whose entire bodies were this family's own tables; taking the two keys
 * with the family was the alternative to leaving two pages behind that import a
 * package this move just created. They keep their place under the project
 * layout route in the table.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is three things rather than the
 * usual two: the port that answers for the session, the address, the deployment
 * and the toasts, and TWO tRPC Providers — this package's own, and
 * `@langwatch/coding-agent-web`'s, which the sessions and pull-request tables
 * run on. `apps/ui` may not import that package (it is not a governed web
 * package), so its api is named here on the shell's behalf, next to the one
 * this package owns.
 */

import type { ComponentType } from "react";

export type PersonalWorkspaceScreenLoader = () => Promise<{ default: ComponentType }>;

export const personalWorkspaceScreens = {
  overview: () => import("./personal-overview.screen"),
  configure: () => import("./personal-configure.screen"),
  sessions: () => import("./personal-sessions.screen"),
  pullRequests: () => import("./personal-pull-requests.screen"),
  budgetRequest: () => import("./personal-budget-request.screen"),
  projectSessions: () => import("./project-sessions.screen"),
  projectPullRequests: () => import("./project-pull-requests.screen"),
} as const satisfies Record<string, PersonalWorkspaceScreenLoader>;

export type PersonalWorkspaceScreenName = keyof typeof personalWorkspaceScreens;

export { personalWorkspaceApi } from "../../behavior/personal-workspace-api";
export { codingAgentApi } from "@langwatch/coding-agent-web/activity";
export {
  PersonalWorkspaceHostPort,
  PersonalWorkspaceHostProvider,
  type PersonalActor,
  type PersonalDeployment,
  type PersonalFailureNotice,
  type PersonalOrganization,
  type PersonalOrganizationRole,
  type PersonalProject,
  type PersonalRouteReading,
  type PersonalScope,
  type PersonalSuccessNotice,
  type PersonalTeam,
} from "../../model/personal-workspace-host";
