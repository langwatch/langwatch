import type { OrganizationIntent, PersonalFeatures } from "@langwatch/organization-contract";

/** One organization row, the fields the organization repository owns. */
export interface MemoryOrganizationRow {
  id: string;
  name: string;
  slug: string;
  supportContact: string | null;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  primaryIntent: OrganizationIntent | null;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One team row, personal or shared. */
export interface MemoryTeamRow {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One organization-level membership row. */
export interface MemoryOrganizationUserRow {
  userId: string;
  organizationId: string;
  disabledAt: Date | null;
}

/** One project row, only the columns the personal workspace needs. */
export interface MemoryProjectRow {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  teamId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  organizationId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  personalFeatures: PersonalFeatures | null;
}

/** One group row, its membership held as a plain set of user ids. */
export interface MemoryGroupRow {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  externalId: string | null;
  scimSource: string | null;
  memberIds: Set<string>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The rows the organization, team and group memory repositories share — one
 * instance per boot, the way `MemoryProjectDatabase` shares tables across the
 * project module's repositories.
 */
export class MemoryOrganizationDatabase {
  readonly organizations = new Map<string, MemoryOrganizationRow>();
  readonly teams = new Map<string, MemoryTeamRow>();
  readonly organizationUsers: MemoryOrganizationUserRow[] = [];
  readonly projects = new Map<string, MemoryProjectRow>();
  readonly groups = new Map<string, MemoryGroupRow>();

  static create(): MemoryOrganizationDatabase {
    return new MemoryOrganizationDatabase();
  }

  private constructor() {}
}
