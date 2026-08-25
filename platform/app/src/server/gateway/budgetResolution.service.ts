/**
 * The one resolver: which gateway budgets constrain a given request, key,
 * or draft key.
 *
 * Every surface that needs "what budgets apply here" reads this: the
 * config materialiser baking the bundle, the debits process deciding
 * where to attribute spend, the pre-request `budget.check`, and the VK
 * drawer's "already applies" list. They used to hand-mirror the same OR
 * list in three places, which is exactly how a scope silently stops being
 * enforced on one path while the UI keeps promising it on another.
 *
 * Two things make the result richer than "a row from GatewayBudget":
 *
 *   - GROUP budgets are per member. One row means "everyone in this
 *     group gets this much, each"; it resolves to one bucket per
 *     (budget, member). A request only ever has one member, the
 *     principal, so a request-time resolve yields at most one bucket per
 *     GROUP budget, keyed `<groupId>:<userId>` so members never share a
 *     pot. Membership is read live, so joining or leaving a group takes
 *     effect on the next materialisation.
 *
 *   - A budget can carry a provider filter (`providerKey`). It still
 *     applies to the key, but it only counts and constrains spend
 *     dispatched to that provider, so callers that know the dispatched
 *     provider must narrow with `budgetAppliesToProvider`.
 *
 * Spec: specs/ai-gateway/gateway-budget-targeting.feature
 *       specs/ai-gateway/budgets-principal-cascade.feature
 */
import type {
  GatewayBudget,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";
import { liveGroupMemberships } from "~/server/app-layer/authz/repositories/live-rows";

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
   * External end-user id on the request, when the caller supplied one.
   * ATTRIBUTED_USER templates resolve to a per-user bucket only when this
   * is set; without it the template resolves as itself (the bundle entry,
   * enforcement fetches buckets on demand).
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

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Which budget scopes this request could match, as one OR list.
 *
 * A scope missing here is a budget that silently never fires, so each arm
 * says what it covers rather than leaving it to the reader.
 */
async function scopePredicatesFor({
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

  // A request belongs to the team its traces land in AND to every team its
  // key is scoped to. Those two differ whenever the key is not scoped to
  // exactly one project, because the trace project then falls back to the
  // organization's governance project: a team-scoped key reported the
  // governance team, and a budget on the team that owns the key matched
  // nothing while both sides looked correctly configured.
  //
  // Reading the key's scopes here rather than making every caller pass
  // them is what puts the fix on all four paths at once, the debit path
  // included, and that is the one that actually accrues spend.
  const teamIds = presentIds([
    target.teamId,
    ...(target.scopedTeamIds ??
      (await keyTeamScopeIds({ client, virtualKeyId: target.virtualKeyId }))),
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
  const templateAnchors = presentIds([target.virtualKeyId, target.projectId]);
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
  const groupIds = await memberGroupIds({
    client,
    organizationId: target.organizationId,
    userId: target.principalUserId,
  });
  if (groupIds.length > 0) {
    ors.push({ scopeType: "GROUP", scopeId: { in: groupIds } });
  }
  return ors;
}

/**
 * Every budget that constrains this target, one entry per enforcement
 * bucket. Ordered by (scopeType, budget id) so callers, bundles, and
 * snapshots stay byte-stable across runs.
 */
export async function resolveApplicableBudgets({
  client,
  target,
}: {
  client: PrismaLike;
  target: BudgetResolutionTarget;
}): Promise<ResolvedBudget[]> {
  const ors = await scopePredicatesFor({ client, target });

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

  return resolved.sort(byScopeThenId);
}

/** The ids actually worth querying: present, non-empty, and each asked for once. */
function presentIds(
  ids: (string | null | undefined)[] | null | undefined,
): string[] {
  if (!ids) return [];
  return Array.from(
    new Set(
      ids.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
}

/**
 * The teams a key is scoped to. Empty when there is no key in context,
 * which is the draft path before the key exists; that caller passes
 * `scopedTeamIds` instead so the drawer previews the same set the key will
 * resolve once it is saved.
 */
async function keyTeamScopeIds({
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
 * The ledger buckets spend by (Scope, ScopeId), so anything that must
 * accrue separately has to be separate in that key. Two budgets on the
 * same target, one counting everything and one counting only OpenAI, would
 * otherwise share a bucket and each report the other's spend. The provider
 * filter therefore rides the bucket id.
 */
export function bucketScopeIdFor(
  budget: Pick<GatewayBudget, "providerKey">,
  baseScopeId: string,
): string {
  return budget.providerKey
    ? `${baseScopeId}${PROVIDER_BUCKET_SEPARATOR}${budget.providerKey}`
    : baseScopeId;
}

export const PROVIDER_BUCKET_SEPARATOR = "|provider:";

/**
 * Group ids the user belongs to within this organization. Scoped to the
 * org so a user in several orgs never drags another org's group
 * budget into this one's cascade.
 */
async function memberGroupIds({
  client,
  organizationId,
  userId,
}: {
  client: PrismaLike;
  organizationId: string;
  userId: string;
}): Promise<string[]> {
  const memberships = await liveGroupMemberships(client).findMany({
    where: { userId, group: { organizationId } },
    select: { groupId: true },
  });
  return memberships.map((m) => m.groupId);
}

/**
 * Per-member bucket key for a GROUP budget. Group ids are nanoids and
 * user ids are cuids, neither contains a colon, so the pair round-trips
 * unambiguously through the ledger's ScopeId column.
 */
export function groupBucketScopeId(
  groupId: string,
  principalUserId: string,
): string {
  return `${groupId}:${principalUserId}`;
}

/**
 * Per-end-user bucket key for an ATTRIBUTED_USER template: the anchor (a
 * virtual key or project id) plus the caller-supplied external id. Anchor
 * ids are nanoids and never contain ":", so the key parses unambiguously
 * from the left; the end-user id is external input and may contain
 * anything, which is why nothing ever parses this key from the right.
 */
export function attributedUserBucketScopeId(
  anchorId: string,
  endUserId: string,
): string {
  return `${anchorId}:${endUserId}`;
}

/**
 * Whether a budget counts spend dispatched to `providerKey`. An unfiltered
 * budget (providerKey null) counts everything; a filtered one counts only
 * its own provider. A dispatch with no reported provider matches only
 * unfiltered budgets: attributing it to a provider-filtered budget would
 * be a guess, and guessing here silently mis-bills a governance control.
 */
export function budgetAppliesToProvider(
  budget: Pick<GatewayBudget, "providerKey">,
  dispatchedProviderKey: string | null | undefined,
): boolean {
  if (!budget.providerKey) return true;
  return budget.providerKey === dispatchedProviderKey;
}

function byScopeThenId(a: ResolvedBudget, b: ResolvedBudget): number {
  if (a.budget.scopeType !== b.budget.scopeType) {
    return a.budget.scopeType < b.budget.scopeType ? -1 : 1;
  }
  if (a.budget.id !== b.budget.id) return a.budget.id < b.budget.id ? -1 : 1;
  return a.bucketScopeId < b.bucketScopeId ? -1 : 1;
}
