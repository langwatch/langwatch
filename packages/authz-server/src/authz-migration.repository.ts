/**
 * ADR-092 stage B - the storage port for the in-place TeamUser backfill
 * (runbook M1). Methods return stored facts and perform batch writes; what
 * a row MEANS - equivalence, parity, when a tenant may finalize - lives in
 * the migration (./team-user-backfill.migration.ts). The app implements
 * this with Prisma
 * (platform/app/src/server/authz/repositories/authz-migration.prisma.repository.ts).
 */
import type { TeamUserRole } from "@langwatch/authz";

/** One legacy TeamUser row, in the vocabulary bindings use: the legacy
 *  `assignedRoleId` column IS the binding's `customRoleId`. */
export type LegacyTeamRow = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
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
