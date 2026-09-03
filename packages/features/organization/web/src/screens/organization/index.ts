/**
 * The organization settings family, as the browser application mounts it.
 *
 * FIVE SCREENS, FIVE ADDRESSES: `/settings/audit-log`, `/settings/members`,
 * `/settings/teams`, `/settings/teams/:team` and `/settings/groups`.
 *
 * The audit trail arrived first and the other four followed with the settings
 * family; they share a transport, a host port and a set of role vocabularies,
 * which is what makes them one package rather than four.
 *
 * WHY THIS IS ITS OWN PACKAGE. The credentials family's rule, read strictly: a
 * key belongs to the family that owns its TRANSPORT, and `organization.*` is
 * mounted from `@langwatch/organization-server`. The RBAC family's exception —
 * the roles pages went to `@langwatch/authz-web` though `role.*` is the role
 * feature's — turns on every TYPE on the page coming from the neighbour, and
 * fails here in both directions: `EnrichedAuditLog` is the organization
 * contract's, the member list the user search matches against is the
 * organization graph's, and the only thing on the page that is not this
 * feature's is the plan gate, which is one boolean off `limits.getUsage`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the organization,
 * the address, the project switcher, the download and the one notice.
 */

import type { ComponentType } from "react";

export type OrganizationScreenLoader = () => Promise<{ default: ComponentType }>;

export const organizationScreens = {
  auditLog: () => import("./audit-log.screen"),
  groups: () => import("./groups.screen"),
  members: () => import("./members.screen"),
  teams: () => import("./teams.screen"),
  teamDetail: () => import("./team-detail.screen"),
} as const satisfies Record<string, OrganizationScreenLoader>;

export type OrganizationScreenName = keyof typeof organizationScreens;

export { AUDIT_LOG_PAGE_PERMISSION } from "./audit-log.screen";
export { GROUPS_PAGE_PERMISSION } from "./groups.screen";
export { MEMBERS_PAGE_PERMISSION } from "./members.screen";
export { TEAMS_PAGE_PERMISSION } from "./teams.screen";
export { TEAM_DETAIL_PAGE_PERMISSION } from "./team-detail.screen";
export { organizationApi } from "../../behavior/organization-api";
export type {
  AuditLogFilters,
  AuditLogPage,
  OrganizationApiMap,
  OrganizationMemberMatch,
} from "../../behavior/organization-api";
export {
  OrganizationHostPort,
  OrganizationHostProvider,
  type OrganizationActor,
  type OrganizationSuccessNotice,
  type OrganizationDownload,
  type OrganizationFailureNotice,
  type OrganizationProjectReading,
  type OrganizationReading,
  type OrganizationRouteReading,
  type OrganizationScope,
  type OrganizationTeamReading,
} from "../../model/organization-host";

/**
 * The department picker and its column, published for `@langwatch/project-web`.
 *
 * A web-to-web edge, and a deliberate one: the general settings page assigns a
 * project to a department with the SAME control the teams and members pages
 * assign a team or a person with, and a second copy of a picker over the same
 * `departments.*` transport would be a second opinion about what an assignment
 * is. The edge is the finding every family since governance carries one of.
 */
export { DepartmentPicker } from "../../ui/elements/department-picker";
export { useDepartmentColumn } from "../../behavior/use-department-column";
