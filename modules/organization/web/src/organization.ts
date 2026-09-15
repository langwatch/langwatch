/** Five settings screens: audit-log, members, teams, team detail, groups. */

import type { ComponentType } from "react";

export type OrganizationScreenLoader = () => Promise<{ default: ComponentType }>;

export const organizationScreens = {
  auditLog: () => import("./ui/sections/organization/audit-log.screen.tsx"),
  groups: () => import("./ui/sections/organization/groups.screen.tsx"),
  members: () => import("./ui/sections/organization/members.screen.tsx"),
  teams: () => import("./ui/sections/organization/teams.screen.tsx"),
  teamDetail: () => import("./ui/sections/organization/team-detail.screen.tsx"),
} as const satisfies Record<string, OrganizationScreenLoader>;

export type OrganizationScreenName = keyof typeof organizationScreens;

export { AUDIT_LOG_PAGE_PERMISSION } from "./ui/sections/organization/audit-log.screen.tsx";
export { GROUPS_PAGE_PERMISSION } from "./ui/sections/organization/groups.screen.tsx";
export { MEMBERS_PAGE_PERMISSION } from "./ui/sections/organization/members.screen.tsx";
export { TEAMS_PAGE_PERMISSION } from "./ui/sections/organization/teams.screen.tsx";
export { TEAM_DETAIL_PAGE_PERMISSION } from "./ui/sections/organization/team-detail.screen.tsx";
export { organizationApi } from "./behavior/organization-api.ts";
export type {
  AuditLogFilters,
  AuditLogPage,
  OrganizationApiMap,
  OrganizationMemberMatch,
} from "./behavior/organization-api.ts";
export {
  OrganizationHostApi,
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
} from "./model/organization-host.ts";

/** Department picker: consistent assignment control across pages. */
export { DepartmentPicker } from "./ui/sections/department-picker.tsx";
export { useDepartmentColumn } from "./behavior/use-department-column.ts";
