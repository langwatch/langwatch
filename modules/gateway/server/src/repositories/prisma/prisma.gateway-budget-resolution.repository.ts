/**
 * The one resolver for which gateway budgets constrain a request, key or draft key — read by the config materialiser, the debits process, pre-request budget.check, and the VK drawer, which used to hand-mirror the same OR list in three places (exactly how a scope silently stops being enforced on one path while the UI still promises it on another). GROUP budgets resolve to one bucket per (budget, member), keyed <groupId>:<userId>, membership read live. A providerKey filter still applies to the key but only constrains spend to that provider, so dispatch-aware callers must narrow with budgetAppliesToProvider. Spec: specs/ai-gateway/gateway-budget-targeting.feature, specs/ai-gateway/budgets-principal-cascade.feature
 */
import type { GatewayBudget, Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
  groupBucketScopeId,
} from "@langwatch/gateway-contract";

export type BudgetResolutionTarget = {
  organizationId: string;
  /**
   * The team the request's traces land in. Callers pass only this one; the
   * teams the key is itself scoped to are read here, from the key, so
   * every path gets them without plumbing (see `keyTeamScopeIds`).
   */
  teamId?: string | null;
  /**
   * The teams the key is scoped to, when the caller already knows them.
   * Omit it and they are read from the key. The draft-key path passes them
   * explicitly because the key it is previewing does not exist yet.
   */
  scopedTeamIds?: string[] | null;
  projectId?: string | null;
  virtualKeyId?: string | null;
  principalUserId?: string | null;
  /**
   * External end-user id, when supplied. ATTRIBUTED_USER templates resolve to a per-user bucket only when this is set; without it the template resolves as itself (enforcement fetches buckets on demand).
   */
  endUserId?: string | null;
};

export type ResolvedBudget = {
  budget: GatewayBudget;
  /**
   * The id spend accumulates under. Equal to `budget.scopeId` for every
   * scope except GROUP (per-member bucket) and ATTRIBUTED_USER with an end
   * user in context (per-user bucket).
   */
  bucketScopeId: string;
  /** The member this bucket belongs to. Only set for GROUP budgets. */
  principalUserId: string | null;
  /** The group the budget targets. Only set for GROUP budgets. */
  groupId: string | null;
  /**
   * The external end user this bucket belongs to. Only set for
   * ATTRIBUTED_USER budgets resolved with an end user in context.
   */
  endUserId: string | null;
};

/**
 * The client slice budget resolution reads, which a transaction client
 * satisfies as readily as the connection itself — the walk runs inside a
 * spend write as often as outside one.
 */
type PrismaLike = Pick<PrismaClient, "gatewayBudget" | "groupMembership" | "virtualKeyScope">;

/**
 * Which budgets a request is subject to: a budget names a SCOPE, not requests, so this expands every scope kind a request could sit under (key, project, team, principal, groups) and unions them — one kind wrong silently stops enforcing a budget somebody set. Ordered, so a caller stopping at the first blocking budget stops at the same one every time.
 */
export class PrismaGatewayBudgetResolutionRepository {
  private constructor() {}

  static create(): PrismaGatewayBudgetResolutionRepository {
    return new PrismaGatewayBudgetResolutionRepository();
  }

  /**
   * Which budget scopes this request could match, as one OR list — a scope missing here is a budget that silently never fires, so each arm says what it covers.
   */
  private async scopePredicatesFor({
    client,
    target,
  }: {
    client: PrismaLike;
    target: BudgetResolutionTarget;
  }): Promise<Prisma.GatewayBudgetWhereInput[]> {
    const ors: Prisma.GatewayBudgetWhereInput[] = [
      { scopeType: "ORGANIZATION", scopeId: target.organizationId },
    ];
    if (target.virtualKeyId) {
      ors.push({ scopeType: "VIRTUAL_KEY", scopeId: target.virtualKeyId });
    }

    // A request belongs to the team its traces land in AND every team its
    // key is scoped to — these differ whenever the key isn't scoped to
    // exactly one project (trace project falls back to the org's governance
    // project), which is why a team-scoped key used to match no budget on
    // its own team. Reading the key's scopes here fixes all four paths at once.
    const teamIds = this.presentIds([
      target.teamId,
      ...(target.scopedTeamIds ??
        (await this.keyTeamScopeIds({
          client,
          virtualKeyId: target.virtualKeyId,
        }))),
    ]);
    if (teamIds.length > 0) {
      ors.push({ scopeType: "TEAM", scopeId: { in: teamIds } });
    }
    if (target.projectId) {
      ors.push({ scopeType: "PROJECT", scopeId: target.projectId });
    }

    // ATTRIBUTED_USER templates anchor on a virtual key or a project: the
    // template applies to every request on its anchor, whoever the end user
    // turns out to be.
    const templateAnchors = this.presentIds([target.virtualKeyId, target.projectId]);
    if (templateAnchors.length > 0) {
      ors.push({
        scopeType: "ATTRIBUTED_USER",
        scopeId: { in: templateAnchors },
      });
    }

    // GROUP budgets only enforce through a member. A key with no principal
    // (a shared org/team/project key) has nobody to charge the per-member
    // bucket to, so group budgets do not apply to it at all.
    if (!target.principalUserId) return ors;

    ors.push({ scopeType: "PRINCIPAL", scopeId: target.principalUserId });
    const groupIds = await this.memberGroupIds({
      client,
      organizationId: target.organizationId,
      userId: target.principalUserId,
    });
    if (groupIds.length > 0) {
      ors.push({ scopeType: "GROUP", scopeId: { in: groupIds } });
    }
    return ors;
  }

  /** The ids actually worth querying: present, non-empty, and each asked for once. */
  private presentIds(ids: (string | null | undefined)[] | null | undefined): string[] {
    if (!ids) return [];
    return Array.from(
      new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)),
    );
  }

  /**
   * Teams a key is scoped to. Empty when there's no key in context (the draft path); that caller passes scopedTeamIds instead so the drawer previews the same set the key will resolve once saved.
   */
  private async keyTeamScopeIds({
    client,
    virtualKeyId,
  }: {
    client: PrismaLike;
    virtualKeyId: string | null | undefined;
  }): Promise<string[]> {
    if (!virtualKeyId) return [];
    const scopes = await client.virtualKeyScope.findMany({
      where: { virtualKeyId, scopeType: "TEAM" },
      select: { scopeId: true },
    });
    return scopes.map((scope) => scope.scopeId);
  }

  /**
   * Group ids the user belongs to within this organization. Scoped to the
   * org so a user in several orgs never drags another org's group
   * budget into this one's cascade.
   */
  private async memberGroupIds({
    client,
    organizationId,
    userId,
  }: {
    client: PrismaLike;
    organizationId: string;
    userId: string;
  }): Promise<string[]> {
    const memberships = await client.groupMembership.findMany({
      where: { userId, group: { organizationId } },
      select: { groupId: true },
    });
    return memberships.map((m) => m.groupId);
  }

  private byScopeThenId(a: ResolvedBudget, b: ResolvedBudget): number {
    if (a.budget.scopeType !== b.budget.scopeType) {
      return a.budget.scopeType < b.budget.scopeType ? -1 : 1;
    }
    if (a.budget.id !== b.budget.id) return a.budget.id < b.budget.id ? -1 : 1;
    return a.bucketScopeId < b.bucketScopeId ? -1 : 1;
  }

  /**
   * Every budget that constrains this target, one entry per enforcement
   * bucket. Ordered by (scopeType, budget id) so callers, bundles, and
   * snapshots stay byte-stable across runs.
   */
  async resolveApplicableBudgets({
    client,
    target,
  }: {
    client: PrismaLike;
    target: BudgetResolutionTarget;
  }): Promise<ResolvedBudget[]> {
    const ors = await this.scopePredicatesFor({
      client,
      target,
    });

    const rows = await client.gatewayBudget.findMany({
      where: {
        organizationId: target.organizationId,
        archivedAt: null,
        OR: ors,
      },
    });
    const resolved = rows.map((budget) => {
      if (budget.scopeType === "GROUP") {
        return {
          budget,
          bucketScopeId: bucketScopeIdFor(
            budget,
            groupBucketScopeId(budget.scopeId, target.principalUserId!),
          ),
          principalUserId: target.principalUserId!,
          groupId: budget.scopeId,
          endUserId: null,
        };
      }
      if (budget.scopeType === "ATTRIBUTED_USER" && target.endUserId) {
        return {
          budget,
          bucketScopeId: bucketScopeIdFor(
            budget,
            attributedUserBucketScopeId(budget.scopeId, target.endUserId),
          ),
          principalUserId: null,
          groupId: null,
          endUserId: target.endUserId,
        };
      }
      return {
        budget,
        bucketScopeId: bucketScopeIdFor(budget, budget.scopeId),
        principalUserId: null,
        groupId: null,
        endUserId: null,
      };
    });

    return resolved.sort((a, b) => this.byScopeThenId(a, b));
  }
}
