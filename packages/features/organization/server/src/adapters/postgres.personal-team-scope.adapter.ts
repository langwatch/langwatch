import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaPersonalTeamScopeRepository } from "../repositories/prisma/prisma.personal-team-scope.repository";
import type {
  PersonalTeamScopeReader,
  RoleBindingScope,
} from "../services/personal-team-scope.service";

/** Binds this deployment's Postgres to the personal-workspace reads. */
export class PostgresPersonalTeamScopeAdapter implements PersonalTeamScopeReader {
  private readonly scopes = PrismaPersonalTeamScopeRepository.create();

  private constructor(private readonly database: PrismaClient) {}

  static create(options: { database: PrismaClient }): PostgresPersonalTeamScopeAdapter {
    return new PostgresPersonalTeamScopeAdapter(options.database);
  }

  /** Every team except the personal workspace each member gets to themselves. */
  findSharedTeamIds(input: { organizationId: string }): Promise<string[]> {
    return this.scopes.findSharedTeamIds({
      client: this.database,
      organizationId: input.organizationId,
    });
  }

  tryFindPersonalTeamInScopes(input: {
    scopes: RoleBindingScope[];
  }): Promise<{ name: string } | null> {
    return this.scopes.tryFindPersonalTeamInScopes({ client: this.database, scopes: input.scopes });
  }

  tryFindForeignPersonalTeamInScopes(input: {
    scopes: RoleBindingScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string } | null> {
    return this.scopes.tryFindForeignPersonalTeamInScopes({ client: this.database, ...input });
  }
}
