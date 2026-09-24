import type {
  CustomRole,
  Organization,
  OrganizationInvite,
  OrganizationUser,
  ProjectRow,
  Team,
  TeamUser,
  User,
} from "@langwatch/organization-contract";
import type {
  CustomRole as CustomRoleRecord,
  Organization as OrganizationRecord,
  OrganizationInvite as OrganizationInviteRecord,
  OrganizationUser as OrganizationUserRecord,
  Project as ProjectRecord,
  Team as TeamRecord,
  TeamUser as TeamUserRecord,
  User as UserRecord,
} from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

export function organizationFromRecord(record: OrganizationRecord): Organization {
  const { connectLastSyncAt: _connectLastSyncAt, ...row } = record;
  return {
    ...row,
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
    sentPlanLimitAlert: row.sentPlanLimitAlert && fromDate(row.sentPlanLimitAlert),
    licenseExpiresAt: row.licenseExpiresAt && fromDate(row.licenseExpiresAt),
    licenseLastValidatedAt: row.licenseLastValidatedAt && fromDate(row.licenseLastValidatedAt),
  };
}

export function inviteFromRecord(record: OrganizationInviteRecord): OrganizationInvite {
  return {
    ...record,
    expiration: record.expiration && fromDate(record.expiration),
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
  };
}

export function organizationUserFromRecord(record: OrganizationUserRecord): OrganizationUser {
  return {
    ...record,
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
    disabledAt: record.disabledAt && fromDate(record.disabledAt),
  };
}

export function userFromRecord(record: UserRecord): User {
  return {
    ...record,
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
    lastLoginAt: record.lastLoginAt && fromDate(record.lastLoginAt),
    deactivatedAt: record.deactivatedAt && fromDate(record.deactivatedAt),
    tracesExplorerTourDismissedAt:
      record.tracesExplorerTourDismissedAt && fromDate(record.tracesExplorerTourDismissedAt),
    passkeyNudgeDismissedAt:
      record.passkeyNudgeDismissedAt && fromDate(record.passkeyNudgeDismissedAt),
  };
}

export function teamFromRecord(record: TeamRecord): Team {
  return {
    ...record,
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
    archivedAt: record.archivedAt && fromDate(record.archivedAt),
  };
}

export function teamUserFromRecord(record: TeamUserRecord): TeamUser {
  return {
    ...record,
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
  };
}

export function customRoleFromRecord(record: CustomRoleRecord): CustomRole {
  return {
    ...record,
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
  };
}

export function projectFromRecord(record: ProjectRecord): ProjectRow {
  return {
    ...record,
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
    archivedAt: record.archivedAt && fromDate(record.archivedAt),
    lastCodingAgentSessionAt:
      record.lastCodingAgentSessionAt && fromDate(record.lastCodingAgentSessionAt),
    lastCodingAgentPullRequestAt:
      record.lastCodingAgentPullRequestAt && fromDate(record.lastCodingAgentPullRequestAt),
  };
}
