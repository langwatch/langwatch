import type { LedgerActor } from "@langwatch/actor";
import type { Team, TeamUserRole } from "~/generated/prisma/client";

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

/** One project of a team, as the REST listing hands it back. */
export interface TeamProjectListing {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamRepository {
  findById(id: string): Promise<Team | null>;
  /**
   * The team's projects a member may see — the organization's hidden
   * `internal_governance` home excluded, per ADR-128.
   *
   * A repository method rather than a query in the route so the leak gate
   * (`src/server/__tests__/projectFilter.invariant.integration.test.ts`) can
   * drive this listing the way it drives every other one.
   */
  findProjectsInTeam(params: {
    teamId: string;
  }): Promise<TeamProjectListing[]>;
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
   * Revoke every TEAM-scoped grant one user holds on a team. Every one of
   * them, not the first found: permissions at a scope are the union of the
   * roles held there, so a member granted both Member and Viewer would
   * otherwise keep the team through the grant the removal did not reach.
   *
   * The returned number is how many bindings the compat projection matched,
   * not a membership verdict. On the ledger path the projection can lag the
   * ledger by one fold, and the revocation is appended even when the
   * projection matched nothing, so `0` does not prove the user held no
   * grants — only that the projection showed none at the time.
   */
  revokeMembership(params: {
    teamId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<number>;
}
