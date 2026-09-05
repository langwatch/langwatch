import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { VirtualKeyAuthorizationRepository } from "../virtual-key-authorization.repository";

/** The client slice a virtual-key authorization decision reads. */
export type VirtualKeyAuthorizationDatabase = Pick<
  PrismaClient,
  "gatewayGuardrail" | "organizationUser" | "project" | "team" | "teamUser" | "virtualKey"
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

  tryFindProjectTeam({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ id: string; teamId: string } | null> {
    return this.database.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true },
    });
  }

  tryFindOrganizationRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ role: string } | null> {
    return this.database.organizationUser.findFirst({
      where: { userId, organizationId, disabledAt: null },
      select: { role: true },
    });
  }

  async findMemberTeamIds({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<string[]> {
    const memberships = await this.database.teamUser.findMany({
      where: { userId, team: { organizationId } },
      select: { teamId: true },
    });

    return memberships.map((membership) => membership.teamId);
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

  async findProjectIdsInOrganization({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<string[]> {
    const projects = await this.database.project.findMany({
      where: { id: { in: projectIds }, team: { organizationId } },
      select: { id: true },
    });

    return projects.map((project) => project.id);
  }

  tryFindVirtualKeyScopes({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<{
    traceProjectId: string | null;
    scopes: Array<{ scopeType: string; scopeId: string }>;
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
