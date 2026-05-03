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
 *        relies on embedded VirtualKeyProviderCredential rows.
 *
 * `setDefault` runs in a transaction so the "exactly one default per
 * scope" invariant (enforced by partial unique idx) can never observe
 * two defaults briefly during the swap.
 */
import { Prisma, type PrismaClient, type RoutingPolicy } from "@prisma/client";
import { TRPCError } from "@trpc/server";

export type RoutingPolicyScope = "organization" | "team" | "project";

export interface CreateRoutingPolicyInput {
  organizationId: string;
  scope: RoutingPolicyScope;
  scopeId: string;
  name: string;
  description?: string | null;
  providerCredentialIds: string[];
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
  providerCredentialIds?: string[];
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
        ...(scope ? { scope } : {}),
        ...(scopeId ? { scopeId } : {}),
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  async findById(id: string): Promise<RoutingPolicy | null> {
    return await this.prisma.routingPolicy.findUnique({ where: { id } });
  }

  async create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy> {
    // Defensive scope normalisation. Typed CreateRoutingPolicyInput
    // already constrains scope to the lowercase enum at compile time,
    // but admin/dogfood scripts that call this service via untyped
    // wrappers can land uppercase variants — and resolveDefaultForUser
    // queries scope='organization' (lowercase) so any uppercase row
    // becomes silently invisible. Lowercase here as belt-and-suspenders.
    const scope = input.scope.toLowerCase() as RoutingPolicyScope;
    await this.assertProviderCredentialsBelongToOrg(
      input.organizationId,
      input.providerCredentialIds,
    );
    return await this.prisma.$transaction(async (tx) => {
      // If isDefault was requested, atomically clear the existing default
      // for this scope tier first so the partial unique idx never trips.
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
          providerCredentialIds: input.providerCredentialIds as Prisma.InputJsonValue,
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
    if (input.providerCredentialIds !== undefined) {
      await this.assertProviderCredentialsBelongToOrg(
        input.organizationId,
        input.providerCredentialIds,
      );
    }

    const data: Prisma.RoutingPolicyUpdateInput = {
      updatedBy: { connect: { id: input.actorUserId } },
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.providerCredentialIds !== undefined)
      data.providerCredentialIds =
        input.providerCredentialIds as Prisma.InputJsonValue;
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
          scope: "team",
          scopeId: personalTeamId,
          isDefault: true,
        },
      });
      if (teamDefault) return teamDefault;
    }

    return await this.prisma.routingPolicy.findFirst({
      where: {
        organizationId,
        scope: "organization",
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
    // id exists in a foreign org. tRPC maps this to HTTP 404 instead of
    // the bare-Error → 500 the caller previously got.
    if (!policy || policy.organizationId !== organizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `RoutingPolicy ${id} not found in this organization`,
      });
    }
    return policy;
  }

  /**
   * Reject any providerCredentialId that doesn't resolve to a
   * GatewayProviderCredential whose project belongs to the supplied
   * organization. Counterpart to VirtualKeyService.create's policy-org
   * check: VK.create trusts that a policy's chain has already been
   * sanitised here, so this is the auth boundary for cross-org chain
   * smuggling. Empty input short-circuits.
   *
   * Uses a two-step query because dbMultiTenancyProtection rejects
   * GatewayProviderCredential queries that don't carry projectId in
   * the WHERE — we resolve the org's project set first, then filter
   * the credentials to that set.
   */
  private async assertProviderCredentialsBelongToOrg(
    organizationId: string,
    providerCredentialIds: string[],
  ): Promise<void> {
    if (providerCredentialIds.length === 0) return;
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Organization has no projects — cannot reference any provider credentials",
      });
    }
    const validCount = await this.prisma.gatewayProviderCredential.count({
      where: {
        id: { in: providerCredentialIds },
        projectId: { in: projectIds },
      },
    });
    if (validCount !== providerCredentialIds.length) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "One or more provider credentials do not belong to this organization",
      });
    }
  }
}
