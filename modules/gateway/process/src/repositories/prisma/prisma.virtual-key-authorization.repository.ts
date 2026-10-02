import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { VirtualKeyAuthorizationRepository } from "../virtual-key-authorization.repository.ts";

/** The client slice a virtual-key authorization decision reads. */
export type VirtualKeyAuthorizationDatabase = Pick<
  PrismaClient,
  "gatewayGuardrail" | "project" | "team" | "virtualKey"
>;

/** Private Prisma owner for the directory a virtual-key write is authorized against. */
export class PrismaVirtualKeyAuthorizationRepository extends VirtualKeyAuthorizationRepository {
  static create(input: {
    database: VirtualKeyAuthorizationDatabase;
  }): PrismaVirtualKeyAuthorizationRepository {
    return new PrismaVirtualKeyAuthorizationRepository(input.database);
  }

  private constructor(private readonly database: VirtualKeyAuthorizationDatabase) {
    super();
  }

  async findProjectIdsForTeams({ teamIds }: { teamIds: string[] }): Promise<string[]> {
    const projects = await this.database.project.findMany({
      where: { teamId: { in: teamIds } },
      select: { id: true },
    });

    return projects.map((project) => project.id);
  }

  async findTeamIdsInOrganization({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: string[];
  }): Promise<string[]> {
    const teams = await this.database.team.findMany({
      where: { id: { in: teamIds }, organizationId },
      select: { id: true },
    });

    return teams.map((team) => team.id);
  }

  findVirtualKeyScopes({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<{
    traceProjectId: string | null;
    scopes: { scopeType: string; scopeId: string }[];
  } | null> {
    return this.database.virtualKey.findFirst({
      where: { id: virtualKeyId, organizationId },
      select: {
        traceProjectId: true,
        scopes: { select: { scopeType: true, scopeId: true } },
      },
    });
  }

  async findGuardrailIdsInProject({
    projectId,
    guardrailIds,
  }: {
    projectId: string;
    guardrailIds: string[];
  }): Promise<string[]> {
    // Scoping by projectId is both the cross-project refusal and what
    // satisfies the multitenancy middleware.
    const rows = await this.database.gatewayGuardrail.findMany({
      where: { id: { in: guardrailIds }, projectId },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }
}
