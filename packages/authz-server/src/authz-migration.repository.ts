/**
 * ADR-092 stage B - the storage port for the in-place TeamUser backfill
 * (runbook M1). Methods return stored facts and perform batch writes; what
 * a row MEANS - equivalence, parity, when a tenant may finalize - lives in
 * the migration (./team-user-backfill.migration.ts). The app implements
 * this with Prisma
 * (platform/app/src/server/app-layer/authz/repositories/authz-migration.prisma.repository.ts).
 */
import type { TeamUserRole } from "@langwatch/authz";

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
  findRoleHeads(args: { organizationId: string }): Promise<RoleHeadRow[]>;
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
