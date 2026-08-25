import {
  Prisma,
  type PrismaClient,
  type RoutingPolicy as PrismaRoutingPolicy,
  type RoutingPolicyScope as PrismaRoutingPolicyScope,
} from "@langwatch/prisma-client/generated";
import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  RoutingPolicyScopeEntry,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-governance-contract";
import { RoutingPolicyRepository } from "../../ports/routing-policy.port";

type PolicyRow = PrismaRoutingPolicy & { scopes: PrismaRoutingPolicyScope[] };

export class PrismaRoutingPolicyRepository extends RoutingPolicyRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaRoutingPolicyRepository {
    return new PrismaRoutingPolicyRepository(database as PrismaClient);
  }

  async list(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    let scopePredicates: Prisma.RoutingPolicyScopeWhereInput[] | undefined;
    if (input.selectableForScope) {
      scopePredicates = await this.ancestorScopePredicates(
        input.organizationId,
        input.selectableForScope,
      );
    }
    const where: Prisma.RoutingPolicyWhereInput = {
      organizationId: input.organizationId,
    };
    if (scopePredicates) where.scopes = { some: { OR: scopePredicates } };
    const rows = await this.database.routingPolicy.findMany({
      where,
      include: { scopes: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return rows.map(mapPolicy);
  }

  async tryFindById(id: string): Promise<RoutingPolicy | null> {
    const row = await this.database.routingPolicy.findUnique({
      where: { id },
      include: { scopes: true },
    });
    return row ? mapPolicy(row) : null;
  }

  async countReachableModelProviders(input: {
    organizationId: string;
    modelProviderIds: string[];
  }): Promise<number> {
    if (input.modelProviderIds.length === 0) return 0;
    const teams = await this.database.team.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    const predicates: Prisma.ModelProviderScopeWhereInput[] = [
      { scopeType: "ORGANIZATION", scopeId: input.organizationId },
    ];
    const teamIds = teams.map(({ id }) => id);
    if (teamIds.length > 0) {
      predicates.push({ scopeType: "TEAM", scopeId: { in: teamIds } });
    }
    const projectIds = teams.flatMap(({ projects }) =>
      projects.map(({ id }) => id),
    );
    if (projectIds.length > 0) {
      predicates.push({ scopeType: "PROJECT", scopeId: { in: projectIds } });
    }
    return this.database.modelProvider.count({
      where: {
        id: { in: input.modelProviderIds },
        scopes: { some: { OR: predicates } },
      },
    });
  }

  async create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    const row = await this.database.$transaction(async (transaction) => {
      if (input.isDefault) {
        for (const scope of input.scopes) {
          await transaction.routingPolicy.updateMany({
            where: {
              organizationId: input.organizationId,
              scopes: {
                some: {
                  scopeType: scope.scopeType,
                  scopeId: scope.scopeId,
                },
              },
              isDefault: true,
            },
            data: { isDefault: false },
          });
        }
      }
      return transaction.routingPolicy.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          modelProviderIds: input.modelProviderIds as Prisma.InputJsonValue,
          isDefault: input.isDefault ?? false,
          modelAliases: (input.modelAliases ?? {}) as Prisma.InputJsonValue,
          defaultModel: input.defaultModel ?? null,
          policyRules: (input.policyRules ?? {}) as Prisma.InputJsonValue,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          scopes: { create: input.scopes },
        },
        include: { scopes: true },
      });
    });
    return mapPolicy(row);
  }

  async update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy> {
    const data: Prisma.RoutingPolicyUpdateInput = {
      updatedBy: { connect: { id: input.actorUserId } },
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.modelProviderIds !== undefined) {
      data.modelProviderIds = input.modelProviderIds as Prisma.InputJsonValue;
    }
    if (input.modelAliases !== undefined) {
      data.modelAliases = input.modelAliases as Prisma.InputJsonValue;
    }
    if (input.defaultModel !== undefined) data.defaultModel = input.defaultModel;
    if (input.policyRules !== undefined) {
      data.policyRules = input.policyRules as Prisma.InputJsonValue;
    }

    const row = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.routingPolicy.update({
        where: { id: input.id },
        data,
        include: { scopes: true },
      });
      await transaction.virtualKey.updateMany({
        where: {
          organizationId: input.organizationId,
          routingPolicyId: input.id,
        },
        data: { revision: { increment: 1n } },
      });
      await transaction.gatewayChangeEvent.create({
        data: {
          organizationId: input.organizationId,
          kind: "ROUTING_POLICY_UPDATED",
          payload: { routingPolicyId: input.id },
        },
      });
      return updated;
    });
    return mapPolicy(row);
  }

  async setDefault(
    input: SetDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy> {
    const target = await this.database.routingPolicy.findUniqueOrThrow({
      where: { id: input.id },
      include: { scopes: true },
    });
    const row = await this.database.$transaction(async (transaction) => {
      for (const scope of target.scopes) {
        await transaction.routingPolicy.updateMany({
          where: {
            organizationId: input.organizationId,
            scopes: {
              some: {
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
              },
            },
            isDefault: true,
            NOT: { id: input.id },
          },
          data: { isDefault: false },
        });
      }
      return transaction.routingPolicy.update({
        where: { id: input.id },
        data: { isDefault: true, updatedById: input.actorUserId },
        include: { scopes: true },
      });
    });
    return mapPolicy(row);
  }

  async delete(input: DeleteRoutingPolicyInput): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.virtualKey.updateMany({
        where: {
          organizationId: input.organizationId,
          routingPolicyId: input.id,
        },
        data: {
          routingPolicyId: null,
          routingMode: "FALLBACK_ALL",
          revision: { increment: 1n },
        },
      });
      await transaction.routingPolicy.delete({ where: { id: input.id } });
      await transaction.gatewayChangeEvent.create({
        data: {
          organizationId: input.organizationId,
          kind: "ROUTING_POLICY_DELETED",
          payload: { routingPolicyId: input.id },
        },
      });
    });
  }

  async tryResolveDefaultForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null> {
    if (input.personalTeamId) {
      const team = await this.database.routingPolicy.findFirst({
        where: {
          organizationId: input.organizationId,
          isDefault: true,
          scopes: {
            some: { scopeType: "TEAM", scopeId: input.personalTeamId },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        include: { scopes: true },
      });
      if (team) return mapPolicy(team);
    }
    const organization = await this.database.routingPolicy.findFirst({
      where: {
        organizationId: input.organizationId,
        isDefault: true,
        scopes: {
          some: {
            scopeType: "ORGANIZATION",
            scopeId: input.organizationId,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      include: { scopes: true },
    });
    return organization ? mapPolicy(organization) : null;
  }

  private async ancestorScopePredicates(
    organizationId: string,
    scope: RoutingPolicyScopeEntry,
  ): Promise<Prisma.RoutingPolicyScopeWhereInput[]> {
    const predicates: Prisma.RoutingPolicyScopeWhereInput[] = [
      { scopeType: "ORGANIZATION", scopeId: organizationId },
    ];
    if (scope.scopeType === "TEAM") {
      predicates.push({ scopeType: "TEAM", scopeId: scope.scopeId });
    }
    if (scope.scopeType === "PROJECT") {
      const project = await this.database.project.findUnique({
        where: { id: scope.scopeId },
        select: { teamId: true },
      });
      if (project) {
        predicates.push({ scopeType: "TEAM", scopeId: project.teamId });
      }
      predicates.push({ scopeType: "PROJECT", scopeId: scope.scopeId });
    }
    return predicates;
  }
}

function mapPolicy(row: PolicyRow): RoutingPolicy {
  const modelProviderIds = Array.isArray(row.modelProviderIds)
    ? row.modelProviderIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const modelAliases = toStringMap(row.modelAliases);
  const policyRules = toObject(row.policyRules);
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    modelProviderIds,
    modelAliases,
    defaultModel: row.defaultModel,
    policyRules,
    isDefault: row.isDefault,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
    createdById: row.createdById,
    updatedById: row.updatedById,
    scopes: row.scopes.map((scope) => ({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    })),
  };
}

function toObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function toStringMap(value: Prisma.JsonValue): Record<string, string> {
  const object = toObject(value);
  const entries = Object.entries(object).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}
