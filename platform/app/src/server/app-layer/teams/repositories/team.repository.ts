import type { Team, TeamUserRole } from "~/generated/prisma/client";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";

export interface CreateTeamInput {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
}

export interface UpdateTeamInput {
  name?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
}

export interface TeamRepository {
  findById(id: string): Promise<Team | null>;
  findAllByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Team>>;
  findBySlugInOrganization(params: {
    slug: string;
    organizationId: string;
  }): Promise<Team | null>;
  create(data: CreateTeamInput): Promise<Team>;
  update(params: {
    id: string;
    organizationId: string;
    data: UpdateTeamInput;
  }): Promise<Team | null>;
  archive(params: { id: string; organizationId: string }): Promise<Team | null>;

  isUserInOrganization(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  /**
   * Grant one user a TEAM-scoped role. Duplicates are rejected rather than
   * skipped: adding somebody who is already in the team is a mistake the
   * caller is told about, not a silent no-op.
   */
  grantMembership(params: {
    teamId: string;
    organizationId: string;
    userId: string;
    role: TeamUserRole;
    actor: LedgerActor;
  }): Promise<void>;

  /**
   * Revoke every TEAM-scoped grant one user holds on a team, and answer how
   * many there were. Every one of them, not the first found: permissions at a
   * scope are the union of the roles held there, so a member granted both
   * Member and Viewer would otherwise keep the team through the grant the
   * removal did not reach.
   */
  revokeMembership(params: {
    teamId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<number>;
}
