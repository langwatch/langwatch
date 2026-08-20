/**
 * ADR-092 stage B - the storage port for the in-place TeamUser backfill
 * (runbook M1). Methods return stored facts and perform batch writes; what
 * a row MEANS - equivalence, parity, when a tenant may finalize - lives in
 * the migration (./team-user-backfill.migration.ts). The app implements
 * this with Prisma
 * (platform/app/src/server/app-layer/authz/repositories/authz-migration.prisma.repository.ts).
 */
import type { TeamUserRole } from "@langwatch/authz";
import type { TenantMigrationStatus } from "@langwatch/system-migrations";

/** One legacy TeamUser row, in the vocabulary bindings use: the legacy
 *  `assignedRoleId` column IS the binding's `customRoleId`. */
export type LegacyTeamRow = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  /** The row's own createdAt: the business time of the backfilled grant,
   *  and part of its deterministic identity (grant-identity.ts). */
  createdAtMs: number;
};

/** An existing TEAM-scoped user binding, for computing what is missing. */
export type ExistingTeamBinding = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
};

export type TeamBindingWrite = {
  bindingId: string;
  organizationId: string;
  userId: string;
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
};

/** The scopes a parity sweep decides over: every team in the organization
 *  and every project with its owning team. */
export type OrganizationScopeInventory = {
  teamIds: string[];
  projects: Array<{ id: string; teamId: string }>;
};

/** One legacy RoleBinding row as stored — the genesis import's inventory
 *  and its proof both speak this shape. */
export type LegacyBindingRow = {
  id: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  createdAtMs: number;
};

/** One legacy CustomRole row as stored. */
export type LegacyRoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
  createdAtMs: number;
};

export type OrganizationMemberFact = {
  userId: string;
  /** The OrganizationUser.role column as stored (ADMIN | MEMBER | ...). */
  role: string;
  createdAtMs: number;
};

/** The Role projection head, re-read for the genesis proof. */
export type RoleHeadRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
};

/**
 * ADR-092 §13, delivery plan PR 2 — the genesis import's storage port:
 * inventory reads over the legacy tables and head reads over the ledger's
 * projections. What a row MEANS (adoption, the floor row, the proof) lives
 * in ./genesis-import.migration.ts.
 */
export interface AuthzGenesisRepository {
  findOrganizationCreatedAtMs(args: {
    organizationId: string;
  }): Promise<number | null>;
  findLegacyBindingRows(args: {
    organizationId: string;
  }): Promise<LegacyBindingRow[]>;
  findLegacyRoleRows(args: {
    organizationId: string;
  }): Promise<LegacyRoleRow[]>;
  findOrganizationMembers(args: {
    organizationId: string;
  }): Promise<OrganizationMemberFact[]>;
  /** Ids present in the Grant head — the convergence check. */
  findGrantHeadIds(args: { organizationId: string }): Promise<string[]>;
  /**
   * Grant head ids whose `source` column is `genesis-import` — the
   * deny-direction sweep's inventory. Every other source's facts (live
   * writes, the backfill, SCIM, invites) are none of this import's
   * business to revoke, so the check must never see them at all.
   */
  findGenesisOwnedGrantHeadIds(args: {
    organizationId: string;
  }): Promise<string[]>;
  findRoleHeads(args: { organizationId: string }): Promise<RoleHeadRow[]>;
}

/** One ADR-057 `ShareLink` row as stored — the cutover's resource-fact
 *  inventory and its import proof both speak this shape. The row's own id
 *  becomes the grant id (adoption), so the compat head converges onto this
 *  very row and the token customers already hold keeps working. */
export type ShareLinkFactRow = {
  id: string;
  token: string;
  /** The stored column's spelling, which the ledger's terms lowercase. */
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
  projectId: string;
  /** Whoever minted the link; null for rows nobody minted by hand. */
  userId: string | null;
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAtMs: number | null;
  maxViews: number | null;
  /** Views already spent on this link. Carried because the cutover has to
   *  hand the budget over, not restart it: the engine takes a cut-over
   *  organization's count from `GrantUsage`, and an unseeded link with
   *  `maxViews` set would go live again with a full budget. */
  viewCount: number;
  createdAtMs: number;
};

/** An `OrganizationUser.role = EXTERNAL` membership: the lite-member fact
 *  the legacy schema stored as a membership column rather than a grant. */
export type ExternalMemberFact = {
  userId: string;
  createdAtMs: number;
};

/** A project carrying the legacy per-project credential (`Project.apiKey`):
 *  the fact behind an ingestion call that names no key row at all. */
export type ProjectCredentialFact = {
  projectId: string;
  createdAtMs: number;
};


/** One RESOURCE-scope `Grant` head row, re-read for the import proof.
 *  Columns as stored: `principalType` and `resourceKind` keep the database's
 *  uppercase spellings, and the proof is where they meet the source row's. */
export type ResourceGrantRow = {
  grantId: string;
  token: string | null;
  resourceKind: string | null;
  /** The RESOURCE scope's id: the shared resource itself. */
  resourceId: string;
  projectId: string | null;
  principalType: string;
  principalId: string | null;
  expiresAtMs: number | null;
  maxViews: number | null;
  /** From `GrantUsage`, the tier's view-accounting row: zero when the link
   *  has no usage row, which is what an unviewed link looks like. */
  viewCount: number;
};

/** One share link's spent views, as the cutover hands them over. */
export type ResourceGrantUsageSeed = {
  grantId: string;
  projectId: string;
  viewCount: number;
};

/**
 * ADR-092 delivery plan PR 3 — the composite cutover migration's storage
 * port: the legacy facts that live OUTSIDE bindings (share links, EXTERNAL
 * memberships, per-project credentials, platform operators), the heads its
 * proofs re-read, and the two lifecycle reads that decide when it may run
 * at all. What any of it MEANS lives in ./cutover.migration.ts.
 */
export interface AuthzCutoverRepository
  extends Pick<AuthzGenesisRepository, "findGrantHeadIds"> {
  /**
   * The stored status of each named migration for one tenant — `null` for a
   * migration that has never run it (`TenantMigrationStatus`'s own docblock:
   * "pending" is the absence of a record, not a stored value). The cutover's
   * prerequisite is that the backfill and the genesis import both finalized:
   * it imports what is left over, and there is nothing to be left over from
   * until they are done.
   */
  findMigrationTenantStatuses(args: {
    tenantId: string;
    migrationNames: readonly string[];
  }): Promise<Record<string, TenantMigrationStatus | null>>;

  findShareLinkRows(args: {
    organizationId: string;
  }): Promise<ShareLinkFactRow[]>;
  findExternalMemberFacts(args: {
    organizationId: string;
  }): Promise<ExternalMemberFact[]>;
  findProjectCredentialFacts(args: {
    organizationId: string;
  }): Promise<ProjectCredentialFact[]>;

  /** The RESOURCE heads, for the import proof. */
  findResourceGrantRows(args: {
    organizationId: string;
  }): Promise<ResourceGrantRow[]>;

  /**
   * Hand each imported link's spent views over to the usage row that becomes
   * their authority.
   *
   * MONOTONIC, never lowering (decision 22: views are never refunded): a
   * missing row is created with the seeded count, and an existing row is
   * RAISED to the seeded count when - and only when - it is lower. The raise
   * exists because the legacy path keeps counting while an organization is
   * held: a view spent on `ShareLink.viewCount` between one pass's seed and
   * the next left the usage row permanently behind, the import proof
   * compares the two counts exactly, and the organization wedged on a drift
   * that only ever grew. Re-seeding upward converges the usage row onto the
   * legacy count each pass, so the proof heals on the next run - while the
   * guard on "lower" keeps a view consumed since the seed from ever being
   * walked back.
   */
  seedResourceGrantUsage(args: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void>;

  /** Every scope the decision-parity proof decides over - the same read and
   *  the same shape the backfill's parity sweep uses
   *  (`AuthzMigrationRepository.findOrganizationScopeInventory`), named once
   *  rather than aliased per migration. */
  findOrganizationScopeInventory(args: {
    organizationId: string;
  }): Promise<OrganizationScopeInventory>;
  /** Every principal the decision-parity proof decides for. Both lists must
   *  come back in a DETERMINISTIC order (sorted by id): the proof's diff
   *  list, its truncation and its command id are derived from iteration
   *  order, and a retry that visited principals differently would name the
   *  same verdict differently. */
  findOrganizationMemberIds(args: { organizationId: string }): Promise<string[]>;
  findOrganizationApiKeyIds(args: { organizationId: string }): Promise<string[]>;

  /** The cutover projection's own answer — what the request-path gate reads,
   *  observed here to know the flip actually landed. */
  findCutoverOnEngine(args: { organizationId: string }): Promise<boolean>;
}

export interface AuthzMigrationRepository {
  findLegacyTeamRows(args: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]>;

  findExistingTeamBindings(args: {
    organizationId: string;
  }): Promise<ExistingTeamBinding[]>;

  /**
   * Batch insert, skipping rows that already exist (the partial unique
   * indexes decide identity). Returns how many rows were actually created.
   */
  createTeamBindings(rows: TeamBindingWrite[]): Promise<number>;

  findOrganizationScopeInventory(args: {
    organizationId: string;
  }): Promise<OrganizationScopeInventory>;
}
