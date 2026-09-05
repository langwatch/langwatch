import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  findSharedTeamIds as readSharedTeamIds,
  tryFindForeignPersonalTeamInScopes,
  tryFindPersonalTeamInScopes,
} from "../repositories/prisma/prisma.personal-team-scope.repository";
import type {
  PersonalTeamScopeReader,
  RoleBindingScope,
} from "../services/personal-team-scope.service";

/** Binds this deployment's Postgres to the personal-workspace reads. */
export class PostgresPersonalTeamScopeAdapter implements PersonalTeamScopeReader {
  private constructor(private readonly database: PrismaClient) {}

  static create(options: { database: PrismaClient }): PostgresPersonalTeamScopeAdapter {
    return new PostgresPersonalTeamScopeAdapter(options.database);
  }

  /** Every team except the personal workspace each member gets to themselves. */
  findSharedTeamIds(input: { organizationId: string }): Promise<string[]> {
    return readSharedTeamIds({ client: this.database, organizationId: input.organizationId });
  }

  tryFindPersonalTeamInScopes(input: {
    scopes: RoleBindingScope[];
  }): Promise<{ name: string } | null> {
    return tryFindPersonalTeamInScopes({ client: this.database, scopes: input.scopes });
  }

  tryFindForeignPersonalTeamInScopes(input: {
    scopes: RoleBindingScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string } | null> {
    return tryFindForeignPersonalTeamInScopes({ client: this.database, ...input });
  }
}
