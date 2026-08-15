// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TRPCError } from "@trpc/server";
/**
 * RoutingPolicyService — admin-defined routing templates that VirtualKeys
 * reference instead of embedding their own fallback chain.
 *
 * Multi-scope model (post-bug-7 step vb): every policy carries one or
 * more `RoutingPolicyScope` rows that determine which VKs can select
 * it. Selectability rule per spec
 * routing-policy-scope-cascade.feature L20-21:
 *
 *   A VK at scope S can select a RoutingPolicy P iff at least one of
 *   P's scope rows is an ancestor of S or equal to S.
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
 * The "exactly one default per scope" invariant is maintained by the
 * `setDefault` transaction (clear other defaults, then set this one),
 * not a DB constraint: scope lives in the child RoutingPolicyScope table
 * so a partial unique index can't express it. `resolveDefaultForUser`
 * therefore orders deterministically so that even if a concurrent write
 * briefly leaves two defaults at a scope, resolution always returns the
 * most recently set one rather than an arbitrary row.
 *
 * Propagation: a policy's contents are folded into every bundle the
 * materialiser builds for a VK that references it, so an edit has to
 * reach the running gateway. `update` and `delete` append a
 * GatewayChangeEvent in the same transaction as the write; the gateway's
 * /changes long-poll picks it up and evicts the organization's cached
 * bundles, which re-materialise against the new policy on the next
 * request. `Options.ConfigTTL` on the gateway is the safety net behind
 * that, not the path.
 */
import {
  Prisma,
  type PrismaClient,
  type RoutingPolicy,
  type RoutingPolicyScope as RoutingPolicyScopeRow,
  RoutingPolicyScopeType,
} from "~/generated/prisma/client";

import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";

export type RoutingPolicyScope = "organization" | "team" | "project";

export type RoutingPolicyScopeEntry = {
  scopeType: RoutingPolicyScopeType;
  scopeId: string;
};

export type RoutingPolicyWithScopes = RoutingPolicy & {
  scopes: RoutingPolicyScopeRow[];
};

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

export class RoutingPolicyMustHaveScopeError extends Error {
  readonly code = "routing_policy_must_have_scope" as const;
  constructor(message = "Routing policy must include at least one scope") {
    super(message);
    this.name = "RoutingPolicyMustHaveScopeError";
  }
}

export interface CreateRoutingPolicyInput {
  organizationId: string;
  scopes: RoutingPolicyScopeEntry[];
  name: string;
  description?: string | null;
  modelProviderIds: string[];
  modelAllowlist?: string[] | null;
  strategy?: "priority" | "cost" | "latency" | "round_robin";
  isDefault?: boolean;
  modelAliases?: Record<string, string>;
  policyRules?: Record<string, unknown>;
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
  modelAliases?: Record<string, string>;
  policyRules?: Record<string, unknown>;
  actorUserId: string;
}

export class RoutingPolicyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly changeEvents = new ChangeEventRepository(prisma),
  ) {}

  /**
   * List policies in an org, optionally filtered to those selectable
   * from a specific scope per the spec cascade rule. When `selectableForScope`
   * is passed, returns every RP that has at least one scope row at the
   * given scope OR an ancestor scope (ORG dominates TEAM dominates PROJECT).
   */
  async list({
    organizationId,
    selectableForScope,
  }: {
    organizationId: string;
    selectableForScope?: { scopeType: RoutingPolicyScopeType; scopeId: string };
  }): Promise<RoutingPolicyWithScopes[]> {
    if (!selectableForScope) {
      return await this.prisma.routingPolicy.findMany({
        where: { organizationId },
        include: { scopes: true },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
    }
    const ancestorPredicates = await this.ancestorScopePredicates(
      organizationId,
      selectableForScope,
    );
    return await this.prisma.routingPolicy.findMany({
      where: {
        organizationId,
        scopes: { some: { OR: ancestorPredicates } },
      },
      include: { scopes: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  async findById(id: string): Promise<RoutingPolicyWithScopes | null> {
    return await this.prisma.routingPolicy.findUnique({
      where: { id },
      include: { scopes: true },
    });
  }

  /**
   * No change event: a policy nothing references yet cannot appear in any
   * bundle, and `isDefault` is consulted at VK issuance, never by the
   * materialiser, so the isDefault clearing below cannot change an
   * already-issued key's bundle either.
   */
  async create(
    input: CreateRoutingPolicyInput,
  ): Promise<RoutingPolicyWithScopes> {
    if (input.scopes.length === 0) {
      throw new RoutingPolicyMustHaveScopeError();
    }
    if (input.modelProviderIds.length === 0) {
      throw new RoutingPolicyMustHaveProviderError();
    }
    await this.assertModelProvidersBelongToOrg(
      input.organizationId,
      input.modelProviderIds,
    );
    return await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        // Clear any existing default whose scope row set overlaps with
        // any of the new scope rows.
        for (const s of input.scopes) {
          await tx.routingPolicy.updateMany({
            where: {
              organizationId: input.organizationId,
              scopes: {
                some: { scopeType: s.scopeType, scopeId: s.scopeId },
              },
              isDefault: true,
            },
            data: { isDefault: false },
          });
        }
      }
      return await tx.routingPolicy.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          modelProviderIds: input.modelProviderIds as Prisma.InputJsonValue,
          modelAllowlist: input.modelAllowlist
            ? (input.modelAllowlist as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          strategy: input.strategy ?? "priority",
          isDefault: input.isDefault ?? false,
          modelAliases: (input.modelAliases ?? {}) as Prisma.InputJsonValue,
          policyRules: (input.policyRules ?? {}) as Prisma.InputJsonValue,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          scopes: {
            create: input.scopes.map((s) => ({
              scopeType: s.scopeType,
              scopeId: s.scopeId,
            })),
          },
        },
        include: { scopes: true },
      });
    });
  }

  /**
   * Edit a policy and tell the gateway about it.
   *
   * The event is unconditional rather than gated on which field moved.
   * Every stored field except `isDefault` reaches a bundle through the
   * materialiser (the provider chain, the allowlist, the aliases, the
   * policy rules), and a gate that has to stay in step with that list is
   * a gate that will one day drop an edit silently. An event costs one
   * insert and one cold re-materialise per key.
   */
  async update(
    input: UpdateRoutingPolicyInput,
  ): Promise<RoutingPolicyWithScopes> {
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
      data.modelProviderIds = input.modelProviderIds as Prisma.InputJsonValue;
    if (input.modelAllowlist !== undefined)
      data.modelAllowlist = input.modelAllowlist
        ? (input.modelAllowlist as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    if (input.strategy !== undefined) data.strategy = input.strategy;
    if (input.modelAliases !== undefined)
      data.modelAliases = input.modelAliases as Prisma.InputJsonValue;
    if (input.policyRules !== undefined)
      data.policyRules = input.policyRules as Prisma.InputJsonValue;

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.routingPolicy.update({
        where: { id: existing.id },
        data,
        include: { scopes: true },
      });
      // The gateway reads a VK's revision only as an ETag today, and it
      // never sends If-None-Match, so nothing consumes this bump yet. It
      // still has to happen: /internal/gateway/config already answers 304
      // to a matching If-None-Match, so the day the gateway starts sending
      // one, a policy edit that left the revision alone would strand every
      // referencing key on a 304 forever.
      await tx.virtualKey.updateMany({
        where: {
          organizationId: input.organizationId,
          routingPolicyId: existing.id,
        },
        data: { revision: { increment: 1n } },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "ROUTING_POLICY_UPDATED",
          payload: { routingPolicyId: updated.id },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Make `id` the default for its scope tier. Atomic swap: clears the
   * existing default in the same transaction across every scope row
   * the target policy carries.
   *
   * No change event: `isDefault` is read by `list` ordering and by
   * `resolveDefaultForUser` at VK issuance, and by nothing the
   * materialiser touches. A key already holds the policy id it was issued
   * against, so swapping which policy is default cannot change any cached
   * bundle, and evicting the organization for it would be pure churn.
   */
  async setDefault({
    id,
    organizationId,
    actorUserId,
  }: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<RoutingPolicyWithScopes> {
    const target = await this.requireOwn(id, organizationId);

    return await this.prisma.$transaction(async (tx) => {
      for (const s of target.scopes) {
        await tx.routingPolicy.updateMany({
          where: {
            organizationId,
            scopes: {
              some: { scopeType: s.scopeType, scopeId: s.scopeId },
            },
            isDefault: true,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }
      return await tx.routingPolicy.update({
        where: { id: target.id },
        data: { isDefault: true, updatedById: actorUserId },
        include: { scopes: true },
      });
    });
  }

  /**
   * Delete a policy and release the keys that pointed at it.
   *
   * The pointer is cleared explicitly rather than left to Prisma's
   * `onDelete: SetNull`: `relationMode = "prisma"` means the referential
   * action is emulated by the client with no SQL foreign key behind it,
   * and it would only reach `routingPolicyId` anyway. `routingMode` has
   * to move in the same statement, because POLICY without a policy id is
   * a state the schema says cannot exist and the materialiser has no
   * chain to build from. Released keys land on FALLBACK_ALL, the mode
   * whose behaviour is closest to the multi-provider chain the policy was
   * already giving them; NONE would silently strip their failover.
   */
  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    await this.requireOwn(id, organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.virtualKey.updateMany({
        where: { organizationId, routingPolicyId: id },
        data: {
          routingPolicyId: null,
          routingMode: "FALLBACK_ALL",
          revision: { increment: 1n },
        },
      });
      await tx.routingPolicy.delete({ where: { id } });
      await this.changeEvents.append(
        {
          organizationId,
          kind: "ROUTING_POLICY_DELETED",
          payload: { routingPolicyId: id },
        },
        tx,
      );
    });
  }

  /**
   * Resolve the default policy for a (user, organization) pair using
   * the TEAM-default-beats-ORG-default rule from the spec.
   *
   * Returns null if the org has no default policy at any tier — caller
   * (currently `PersonalVirtualKeyService.issue`) falls back to minting
   * the VK with `routingPolicyId: null`, which the gateway resolves via
   * scope cascade + `fallbackPriorityGlobal` ordering on every eligible
   * ModelProvider.
   */
  async resolveDefaultForUser({
    organizationId,
    personalTeamId,
  }: {
    organizationId: string;
    personalTeamId?: string;
  }): Promise<RoutingPolicyWithScopes | null> {
    if (personalTeamId) {
      const teamDefault = await this.prisma.routingPolicy.findFirst({
        where: {
          organizationId,
          isDefault: true,
          scopes: {
            some: {
              scopeType: RoutingPolicyScopeType.TEAM,
              scopeId: personalTeamId,
            },
          },
        },
        // Deterministic tiebreak: if a concurrent setDefault briefly left
        // two defaults at this scope, resolve to the most recently set one.
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        include: { scopes: true },
      });
      if (teamDefault) return teamDefault;
    }

    return await this.prisma.routingPolicy.findFirst({
      where: {
        organizationId,
        isDefault: true,
        scopes: {
          some: {
            scopeType: RoutingPolicyScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      include: { scopes: true },
    });
  }

  private async requireOwn(
    id: string,
    organizationId: string,
  ): Promise<RoutingPolicyWithScopes> {
    const policy = await this.prisma.routingPolicy.findUnique({
      where: { id },
      include: { scopes: true },
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
   * For the spec selectability rule, return the set of scope-row
   * predicates that "the given scope can see". A VK at PROJECT P sees
   * RPs scoped at PROJECT P, TEAM containing P, or ORG containing P.
   */
  private async ancestorScopePredicates(
    organizationId: string,
    scope: { scopeType: RoutingPolicyScopeType; scopeId: string },
  ): Promise<Prisma.RoutingPolicyScopeWhereInput[]> {
    const predicates: Prisma.RoutingPolicyScopeWhereInput[] = [
      {
        scopeType: RoutingPolicyScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    ];
    if (scope.scopeType === RoutingPolicyScopeType.TEAM) {
      predicates.push({
        scopeType: RoutingPolicyScopeType.TEAM,
        scopeId: scope.scopeId,
      });
    } else if (scope.scopeType === RoutingPolicyScopeType.PROJECT) {
      const project = await this.prisma.project.findUnique({
        where: { id: scope.scopeId },
        select: { teamId: true },
      });
      if (project) {
        predicates.push({
          scopeType: RoutingPolicyScopeType.TEAM,
          scopeId: project.teamId,
        });
      }
      predicates.push({
        scopeType: RoutingPolicyScopeType.PROJECT,
        scopeId: scope.scopeId,
      });
    } else {
      // ORG scope sees only ORG-scoped policies (no descent leakage).
    }
    return predicates;
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
                ? [
                    {
                      scopeType: "PROJECT" as const,
                      scopeId: { in: projectIds },
                    },
                  ]
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

// Re-export legacy wire-shape helper for callers that still pass the
// string form (e.g. CLI + integration tests). Will drop once consumers
// are swept to the enum directly.
export { toEnumScope };
