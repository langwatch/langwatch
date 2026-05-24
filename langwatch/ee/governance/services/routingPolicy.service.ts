// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * RoutingPolicyService — admin-defined routing templates that VirtualKeys
 * reference instead of embedding their own fallback chain.
 *
 * Resolution rules (consulted at VK issuance time, not at request time):
 *
 *   resolveDefaultForUser(userId, organizationId) =
 *     1. The TEAM-scoped default policy for the user's personal team
 *        (if one exists at that scope).
 *     2. else the ORG-scoped default policy.
 *     3. else null — caller should fall back to a no-policy VK that
 *        relies on the scope-cascade-resolved ModelProvider set.
 *
 * `setDefault` runs in a transaction so the "exactly one default per
 * scope" invariant (enforced by partial unique idx) can never observe
 * two defaults briefly during the swap.
 */
import {
  Prisma,
  type PrismaClient,
  type RoutingPolicy,
  RoutingPolicyScopeType,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

export type RoutingPolicyScope = "organization" | "team" | "project";

const WIRE_TO_ENUM: Record<RoutingPolicyScope, RoutingPolicyScopeType> = {
  organization: RoutingPolicyScopeType.ORGANIZATION,
  team: RoutingPolicyScopeType.TEAM,
  project: RoutingPolicyScopeType.PROJECT,
};

function toEnumScope(scope: RoutingPolicyScope): RoutingPolicyScopeType {
  const value = WIRE_TO_ENUM[scope.toLowerCase() as RoutingPolicyScope];
  if (!value) {
    throw new Error(`Invalid routing policy scope: ${scope}`);
  }
  return value;
}

/**
 * EC#3 — a routing policy must reference at least one ModelProvider.
 * An empty `modelProviderIds` produces a policy that silently fails
 * closed at materialise-time (chain length 0) without a clear admin
 * signal. The router maps this to 422 with the
 * `routing_policy_must_have_provider` code.
 */
export class RoutingPolicyMustHaveProviderError extends Error {
  readonly code = "routing_policy_must_have_provider" as const;
  constructor(
    message = "Routing policy must include at least one ModelProvider",
  ) {
    super(message);
    this.name = "RoutingPolicyMustHaveProviderError";
  }
}

export interface CreateRoutingPolicyInput {
  organizationId: string;
  scope: RoutingPolicyScope;
  scopeId: string;
  name: string;
  description?: string | null;
  modelProviderIds: string[];
  modelAllowlist?: string[] | null;
  strategy?: "priority" | "cost" | "latency" | "round_robin";
  isDefault?: boolean;
  actorUserId: string;
}

export interface UpdateRoutingPolicyInput {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  modelProviderIds?: string[];
  modelAllowlist?: string[] | null;
  strategy?: "priority" | "cost" | "latency" | "round_robin";
  actorUserId: string;
}

export class RoutingPolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async list({
    organizationId,
    scope,
    scopeId,
  }: {
    organizationId: string;
    scope?: RoutingPolicyScope;
    scopeId?: string;
  }): Promise<RoutingPolicy[]> {
    return await this.prisma.routingPolicy.findMany({
      where: {
        organizationId,
        ...(scope ? { scope: toEnumScope(scope) } : {}),
        ...(scopeId ? { scopeId } : {}),
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  async findById(id: string): Promise<RoutingPolicy | null> {
    return await this.prisma.routingPolicy.findUnique({ where: { id } });
  }

  async create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    const scope = toEnumScope(input.scope);
    if (input.modelProviderIds.length === 0) {
      throw new RoutingPolicyMustHaveProviderError();
    }
    await this.assertModelProvidersBelongToOrg(
      input.organizationId,
      input.modelProviderIds,
    );
    return await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.routingPolicy.updateMany({
          where: {
            organizationId: input.organizationId,
            scope,
            scopeId: input.scopeId,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return await tx.routingPolicy.create({
        data: {
          organizationId: input.organizationId,
          scope,
          scopeId: input.scopeId,
          name: input.name,
          description: input.description ?? null,
          modelProviderIds: input.modelProviderIds as Prisma.InputJsonValue,
          modelAllowlist: input.modelAllowlist
            ? (input.modelAllowlist as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          strategy: input.strategy ?? "priority",
          isDefault: input.isDefault ?? false,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });
    });
  }

  async update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (input.modelProviderIds !== undefined) {
      if (input.modelProviderIds.length === 0) {
        throw new RoutingPolicyMustHaveProviderError();
      }
      await this.assertModelProvidersBelongToOrg(
        input.organizationId,
        input.modelProviderIds,
      );
    }

    const data: Prisma.RoutingPolicyUpdateInput = {
      updatedBy: { connect: { id: input.actorUserId } },
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.modelProviderIds !== undefined)
      data.modelProviderIds =
        input.modelProviderIds as Prisma.InputJsonValue;
    if (input.modelAllowlist !== undefined)
      data.modelAllowlist = input.modelAllowlist
        ? (input.modelAllowlist as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    if (input.strategy !== undefined) data.strategy = input.strategy;

    return await this.prisma.routingPolicy.update({
      where: { id: existing.id },
      data,
    });
  }

  /**
   * Make `id` the default for its scope tier. Atomic swap: clears the
   * existing default in the same transaction.
   */
  async setDefault({
    id,
    organizationId,
    actorUserId,
  }: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<RoutingPolicy> {
    const target = await this.requireOwn(id, organizationId);

    return await this.prisma.$transaction(async (tx) => {
      await tx.routingPolicy.updateMany({
        where: {
          organizationId,
          scope: target.scope,
          scopeId: target.scopeId,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });

      return await tx.routingPolicy.update({
        where: { id: target.id },
        data: { isDefault: true, updatedById: actorUserId },
      });
    });
  }

  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    await this.requireOwn(id, organizationId);
    await this.prisma.routingPolicy.delete({ where: { id } });
  }

  /**
   * Resolve the default policy for a (user, organization) pair using
   * the TEAM-default-beats-ORG-default rule from the spec.
   *
   * Returns null if the org has no default policy at any tier — caller
   * is expected to translate to a 409 `no_default_routing_policy`
   * (see `NoDefaultRoutingPolicyError` in personalVirtualKey.service).
   */
  async resolveDefaultForUser({
    organizationId,
    personalTeamId,
  }: {
    organizationId: string;
    personalTeamId?: string;
  }): Promise<RoutingPolicy | null> {
    if (personalTeamId) {
      const teamDefault = await this.prisma.routingPolicy.findFirst({
        where: {
          organizationId,
          scope: RoutingPolicyScopeType.TEAM,
          scopeId: personalTeamId,
          isDefault: true,
        },
      });
      if (teamDefault) return teamDefault;
    }

    return await this.prisma.routingPolicy.findFirst({
      where: {
        organizationId,
        scope: RoutingPolicyScopeType.ORGANIZATION,
        scopeId: organizationId,
        isDefault: true,
      },
    });
  }

  private async requireOwn(
    id: string,
    organizationId: string,
  ): Promise<RoutingPolicy> {
    const policy = await this.prisma.routingPolicy.findUnique({
      where: { id },
    });
    // Collapse "not found" + "found-but-wrong-org" into the same NOT_FOUND
    // response — leaking the distinction would tell an attacker that an
    // id exists in a foreign org.
    if (!policy || policy.organizationId !== organizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `RoutingPolicy ${id} not found in this organization`,
      });
    }
    return policy;
  }

  /**
   * Reject any modelProviderId that doesn't resolve to a ModelProvider
   * reachable from the supplied organization. Counterpart to
   * VirtualKeyService.create's policy-org check: VK.create trusts that
   * a policy's chain has already been sanitised here.
   *
   * Reachability = the MP has at least one scope row pointing at the
   * organization, one of its teams, or one of its projects.
   */
  private async assertModelProvidersBelongToOrg(
    organizationId: string,
    modelProviderIds: string[],
  ): Promise<void> {
    if (modelProviderIds.length === 0) return;
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    const teamIds = teams.map((t) => t.id);
    const projectIds = teams.flatMap((t) => t.projects.map((p) => p.id));
    const reachable = await this.prisma.modelProvider.count({
      where: {
        id: { in: modelProviderIds },
        scopes: {
          some: {
            OR: [
              { scopeType: "ORGANIZATION", scopeId: organizationId },
              ...(teamIds.length > 0
                ? [{ scopeType: "TEAM" as const, scopeId: { in: teamIds } }]
                : []),
              ...(projectIds.length > 0
                ? [{ scopeType: "PROJECT" as const, scopeId: { in: projectIds } }]
                : []),
            ],
          },
        },
      },
    });
    if (reachable !== modelProviderIds.length) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "One or more ModelProviders are not reachable from this organization",
      });
    }
  }
}
