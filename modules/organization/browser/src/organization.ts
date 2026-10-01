/** Five settings screens: audit-log, members, teams, team detail, groups. */

export { organizationApi } from "./behavior/organization-api.ts";
export type {
  AuditLogFilters,
  AuditLogPage,
  OrganizationApiMap,
  OrganizationMemberMatch,
} from "./behavior/organization-api.ts";
export {
  AUDIT_LOG_PAGE_PERMISSION,
  GROUPS_PAGE_PERMISSION,
  MEMBERS_PAGE_PERMISSION,
  OrganizationHostApi,
  OrganizationHostProvider,
  TEAM_DETAIL_PAGE_PERMISSION,
  TEAMS_PAGE_PERMISSION,
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
