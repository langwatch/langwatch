/**
 * The organization settings family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/audit-log`.
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
} as const satisfies Record<string, OrganizationScreenLoader>;

export type OrganizationScreenName = keyof typeof organizationScreens;

export { AUDIT_LOG_PAGE_PERMISSION } from "./audit-log.screen";
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
  type OrganizationDownload,
  type OrganizationFailureNotice,
  type OrganizationProjectReading,
  type OrganizationReading,
  type OrganizationRouteReading,
  type OrganizationScope,
  type OrganizationTeamReading,
} from "../../model/organization-host";
