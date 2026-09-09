/**
 * The personal workspace (ADR-004: one owner-only export per composing feature). A loader per page, not a barrel, so no chunk pulls in all seven addresses. Two are project-scoped (`/:project/sessions`, `/:project/pull-requests`) but kept here since their bodies were this family's own tables; the owning feature mounts TWO tRPC Providers — this package's and `@langwatch/coding-agent-web`'s.
 */

import type { ComponentType } from "react";

export type PersonalWorkspaceScreenLoader = () => Promise<{ default: ComponentType }>;

export const personalWorkspaceScreens = {
  overview: () => import("./ui/sections/personal-workspace/personal-overview.screen.tsx"),
  configure: () => import("./ui/sections/personal-workspace/personal-configure.screen.tsx"),
  sessions: () => import("./ui/sections/personal-workspace/personal-sessions.screen.tsx"),
  pullRequests: () =>
    import("./ui/sections/personal-workspace/personal-pull-requests.screen.tsx"),
  budgetRequest: () =>
    import("./ui/sections/personal-workspace/personal-budget-request.screen.tsx"),
  projectSessions: () => import("./ui/sections/personal-workspace/project-sessions.screen.tsx"),
  projectPullRequests: () =>
    import("./ui/sections/personal-workspace/project-pull-requests.screen.tsx"),
  authentication: () => import("./ui/sections/personal-workspace/authentication.screen.tsx"),
} as const satisfies Record<string, PersonalWorkspaceScreenLoader>;

export type PersonalWorkspaceScreenName = keyof typeof personalWorkspaceScreens;

export {
  canChangePassword,
  isCredentialAccount,
  isRemovableMethod,
  isSecurityKey,
  passkeyLabel,
  providerDisplayName,
} from "./model/sign-in-methods.ts";
export { personalWorkspaceApi } from "./behavior/personal-workspace-api.ts";
export { codingAgentApi } from "@langwatch/coding-agent-web/surfaces/activity";
export {
  PersonalWorkspaceHostPort,
  PersonalWorkspaceHostProvider,
  type HeldPasskey,
  type LinkSignInMethodOutcome,
  type PasskeyOutcome,
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
} from "./model/personal-workspace-host.ts";
