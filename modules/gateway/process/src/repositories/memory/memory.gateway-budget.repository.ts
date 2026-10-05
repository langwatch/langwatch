import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
  budgetAppliesToProvider,
  computeBudgetPeriodFloorMs,
  GatewayBudgetCycleAnchorInvalidError,
  GatewayBudgetNotFoundError,
  GatewayScopeOrgMismatchError,
  GatewayWindow,
  groupBucketScopeId,
  identityPatchData,
  scopeTargetKey,
  serializeRowForAudit,
  translateExternalIdConflict,
  usdToNanoUsd,
  VirtualKeyNotFoundError,
  type GatewayBudget,
  type GatewayBudgetPageInput,
  type GatewayBudgetResource,
  type GatewayBudgetScope,
  type GatewayBudgetScopeTarget,
  type GatewayBudgetScopeType,
  type GatewayBudgetWithSeats,
  type GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { nowInstant, Temporal, toDate, type Instant } from "@langwatch/time";

import type { GatewayAuditAction, GatewayAuditRepository } from "../gateway-audit.repository.ts";
import type {
  BudgetBucketBoundary,
  GatewayBudgetSpendRepository,
} from "../gateway-budget-spend.repository.ts";
import {
  GatewayBudgetRepository,
  type ArchiveBudgetInput,
  type AttributedUserBudgetTemplate,
  type BucketBoundaryRow,
  type BudgetCheckResult,
  type BudgetDetail,
  type BudgetHealth,
  type BudgetListWithHealth,
  type BudgetPageWithHealth,
  type CreateBudgetInput,
  type GatewayBudgetCheckReadInput,
  type GatewayBudgetReadInput,
  type GatewayBudgetResolutionRead,
  type GatewayKeyReachRow,
  type GatewayOrganizationBudgetReadInput,
  type GatewayProjectBudgetReadInput,
  type GatewayVirtualKeyProjectScope,
  type UpdateBudgetInput,
} from "../gateway-budget.repository.ts";
import type { GatewayChangeEventsRepository } from "../gateway-change-event.repository.ts";
import {
  memoryGatewayDecimal,
  memoryKeysetAfter,
  memoryKeysetCompare,
  MemoryGatewayUniqueConflictError,
  type MemoryGatewayStore,
  type MemoryKeysetColumn,
} from "./memory.gateway.store.ts";

const logger = createLogger("langwatch:gateway:budget-memory-repository");

/** The scope enum's declared order, which is how Postgres sorts it. */
const SCOPE_ORDER: readonly GatewayBudgetScopeType[] = [
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
  "VIRTUAL_KEY",
  "PRINCIPAL",
  "GROUP",
  "ATTRIBUTED_USER",
];

/** What the budget twin reads beside its own rows: the ledger, change feed and audit trail. */
type MemoryBudgetCollaborators = Readonly<{
  store: MemoryGatewayStore;
  budgetSpend: GatewayBudgetSpendRepository;
  changes: GatewayChangeEventsRepository;
  audit: GatewayAuditRepository;
}>;

/** Fixed-point scale for the pre-request arithmetic: exact for every money string in play. */
const SCALE = 18;

/**
 * Budgets over the shared rows, spend from the ledger twin: the same reads,
 * guards, change events, audit rows and pre-request decision the live
 * repository answers, so a memory process enforces what a live one does.
 */
export class MemoryGatewayBudgetRepository extends GatewayBudgetRepository {
  static create(input: MemoryBudgetCollaborators): MemoryGatewayBudgetRepository {
    return new MemoryGatewayBudgetRepository(input);
  }

  private readonly store: MemoryGatewayStore;
  private readonly spend: GatewayBudgetSpendRepository;
  private readonly changes: GatewayChangeEventsRepository;
  private readonly audit: GatewayAuditRepository;

  private constructor(input: MemoryBudgetCollaborators) {
    super();
    this.store = input.store;
    this.spend = input.budgetSpend;
    this.changes = input.changes;
    this.audit = input.audit;
  }

  async resolveApplicableBudgets(
    input: GatewayBudgetResolutionRead,
  ): Promise<GatewayResolvedBudget[]> {
    return this.#resolve(input);
  }

  async resolveScopeTargets(input: {
    budgets: { scopeType: string; scopeId: string }[];
    organizationId: string | null;
    projects: ProjectIdentity[];
    virtualKeyProjectScopes: GatewayVirtualKeyProjectScope[];
  }): Promise<Map<string, GatewayBudgetScopeTarget>> {
    const idsOf = (kind: string) =>
      new Set(input.budgets.filter((b) => b.scopeType === kind).map((b) => b.scopeId));
    const projectsById = new Map(input.projects.map((project) => [project.id, project]));
    const targets: GatewayBudgetScopeTarget[] = [...idsOf("PROJECT")].flatMap((id) => {
      const project = projectsById.get(id);
      return project ? [{ kind: "PROJECT", id, name: project.name, secondary: project.slug }] : [];
    });
    const { organizationId } = input;
    if (organizationId) {
      targets.push(
        ...this.#namedTargets({ organizationId, idsOf }),
        ...this.#keyTargets({
          organizationId,
          ids: idsOf("VIRTUAL_KEY"),
          projectsById,
          projectOfKey: new Map(
            input.virtualKeyProjectScopes.map((scope) => [scope.virtualKeyId, scope.projectId]),
          ),
        }),
        ...this.#peopleTargets({ organizationId, idsOf }),
        ...this.#anchorTargets({ organizationId, ids: idsOf("ATTRIBUTED_USER"), projectsById }),
      );
    }

    return new Map(targets.map((target) => [scopeTargetKey(target.kind, target.id), target]));
  }

  /** The organization itself and its teams, by name and slug. */
  #namedTargets(input: {
    organizationId: string;
    idsOf: (kind: string) => Set<string>;
  }): GatewayBudgetScopeTarget[] {
    const organizations = input.idsOf("ORGANIZATION");
    const teams = input.idsOf("TEAM");
    return [
      ...this.store.organizations
        .filter((row) => row.id === input.organizationId && organizations.has(row.id))
        .map((row) => ({ kind: "ORGANIZATION", id: row.id, name: row.name, secondary: row.slug })),
      ...this.#teamsOf(input.organizationId)
        .filter((team) => teams.has(team.id))
        .map((team) => ({ kind: "TEAM", id: team.id, name: team.name, secondary: team.slug })),
    ];
  }

  /** The organization's keys by name and prefix, with their scoped project's slug. */
  #keyTargets(input: {
    organizationId: string;
    ids: Set<string>;
    projectsById: Map<string, ProjectIdentity>;
    projectOfKey: Map<string, string>;
  }): GatewayBudgetScopeTarget[] {
    return this.#keysOf(input.organizationId)
      .filter((key) => input.ids.has(key.id))
      .map((key) => {
        const projectId = input.projectOfKey.get(key.id);
        const project = projectId ? input.projectsById.get(projectId) : undefined;
        return {
          kind: "VIRTUAL_KEY",
          id: key.id,
          name: key.name,
          secondary: key.displayPrefix ? `${key.displayPrefix}…` : null,
          projectSlug: project?.slug ?? null,
        };
      });
  }

  /** Members of the organization by name or email, and its groups with their sizes. */
  #peopleTargets(input: {
    organizationId: string;
    idsOf: (kind: string) => Set<string>;
  }): GatewayBudgetScopeTarget[] {
    const principals = input.idsOf("PRINCIPAL");
    const groups = input.idsOf("GROUP");
    return [
      ...this.store.users
        .filter((user) => principals.has(user.id))
        .filter((user) => user.organizationIds.includes(input.organizationId))
        .map((user) => ({
          kind: "PRINCIPAL",
          id: user.id,
          name: user.name ?? user.email ?? user.id,
          secondary: user.email ?? null,
        })),
      ...this.store.groups
        .filter((group) => groups.has(group.id) && group.organizationId === input.organizationId)
        .map((group) => ({
          kind: "GROUP",
          id: group.id,
          name: group.name,
          secondary: group.slug ?? null,
          memberCount: this.store.groupMemberships.filter((row) => row.groupId === group.id).length,
        })),
    ];
  }

  /** A per-person template's anchor: an organization project, or one of its keys (which wins). */
  #anchorTargets(input: {
    organizationId: string;
    ids: Set<string>;
    projectsById: Map<string, ProjectIdentity>;
  }): GatewayBudgetScopeTarget[] {
    const projects = [...input.ids].flatMap((id) => {
      const project = input.projectsById.get(id);
      return project?.organizationId === input.organizationId
        ? [{ kind: "ATTRIBUTED_USER", id, name: project.name, secondary: project.slug }]
        : [];
    });
    const keys = this.#keysOf(input.organizationId)
      .filter((key) => input.ids.has(key.id))
      .map((key) => ({
        kind: "ATTRIBUTED_USER",
        id: key.id,
        name: key.name,
        secondary: key.displayPrefix ? `${key.displayPrefix}…` : null,
      }));
    return [...projects, ...keys];
  }

  async findVirtualKeyProjectScopes(input: {
    organizationId: string | null;
    virtualKeyIds: string[];
  }): Promise<GatewayVirtualKeyProjectScope[]> {
    const { organizationId } = input;
    if (!organizationId || input.virtualKeyIds.length === 0) return [];
    const ids = new Set(input.virtualKeyIds);

    return this.#keysOf(organizationId)
      .filter((key) => ids.has(key.id))
      .flatMap((key) => {
        const projectId = key.scopes.find((scope) => scope.scopeType === "PROJECT")?.scopeId;
        return projectId ? [{ virtualKeyId: key.id, projectId }] : [];
      });
  }

  async findAll(input: GatewayOrganizationBudgetReadInput): Promise<GatewayBudgetWithSeats[]> {
    return (await this.#withSpend(this.#listed(input.organizationId), input)).budgets;
  }

  async findForProject(input: GatewayProjectBudgetReadInput): Promise<GatewayBudgetWithSeats[]> {
    return (await this.#withSpend(this.#forProject(input), input)).budgets;
  }

  async findWithHealth(input: GatewayOrganizationBudgetReadInput): Promise<BudgetListWithHealth> {
    return {
      ...(await this.#withSpend(this.#listed(input.organizationId), input)),
      scopeReach: new Map(),
    };
  }

  async findPageWithHealth(
    input: GatewayBudgetPageInput & GatewayOrganizationBudgetReadInput,
  ): Promise<BudgetPageWithHealth> {
    const { cursor } = input;
    const matching = this.#live(input.organizationId).filter(
      (budget) =>
        (input.scopeTypes === undefined || input.scopeTypes.includes(budget.scopeType)) &&
        (input.externalId === undefined || budget.externalId === input.externalId),
    );
    const page = matching
      .filter(
        (budget) =>
          cursor === null || memoryKeysetAfter(newestFirst(budget), [cursor.createdAt, cursor.id]),
      )
      .toSorted((left, right) => memoryKeysetCompare(newestFirst(left), newestFirst(right)))
      .slice(0, input.limit);
    const list = await this.#withSpend(page, input);

    return { ...list, scopeReach: new Map(), total: matching.length };
  }

  async findForProjectWithHealth(
    input: GatewayProjectBudgetReadInput,
  ): Promise<BudgetListWithHealth> {
    return { ...(await this.#withSpend(this.#forProject(input), input)), scopeReach: new Map() };
  }

  async findById(input: GatewayBudgetReadInput): Promise<GatewayBudgetWithSeats | null> {
    const stored = this.#stored(input);
    if (!stored) return null;
    const { budgets } = await this.#withSpend([stored], input);
    return budgets[0] ?? stored;
  }

  async findHealthById(input: GatewayBudgetReadInput): Promise<BudgetHealth | null> {
    const stored = this.#stored(input);
    if (!stored || stored.archivedAt !== null) return null;
    const { budgets, spendAvailable, readAt } = await this.#withSpend([stored], input);
    return { budget: budgets[0] ?? stored, spendAvailable, readAt, unreachableByAnyKey: false };
  }

  async findDetailById(input: GatewayBudgetReadInput): Promise<BudgetDetail | null> {
    const stored = this.#stored(input);
    if (!stored) return null;
    const { budgets, spendAvailable } = await this.#withSpend([stored], input);
    const budget = budgets[0] ?? stored;
    const events =
      input.tenantIds.length > 0
        ? await this.spend.recentEventsForBudget(input.tenantIds, budget.id, 20)
        : [];

    return {
      budget,
      scopeTarget: {
        kind: budget.scopeType,
        id: budget.scopeId,
        name: budget.scopeId,
        secondary: null,
      },
      recentLedger: events.map((event) => {
        const key = this.store.virtualKeys.get(event.virtualKeyId);
        return {
          id: event.id,
          virtualKeyId: event.virtualKeyId,
          amountUsd: memoryGatewayDecimal(event.amountUsd, 9),
          model: event.model,
          status: event.status,
          occurredAt: event.occurredAt,
          virtualKey: key ? { name: key.name, displayPrefix: key.displayPrefix } : null,
        };
      }),
      spendAvailable,
      unreachableByAnyKey: false,
    };
  }

  async findScopeReachCandidates(organizationId: string): Promise<GatewayKeyReachRow[]> {
    return this.#keysOf(organizationId)
      .filter((key) => key.status === "ACTIVE")
      .map((key) => ({
        organizationId: key.organizationId,
        scopedTeamIds: key.scopes
          .filter((scope) => scope.scopeType === "TEAM")
          .map((scope) => scope.scopeId),
        traceProjectId: key.traceProjectId,
        virtualKeyId: key.id,
        principalUserId: key.principalUserId,
      }));
  }

  async assertScopeWithinOrganization(input: CreateBudgetInput): Promise<void> {
    const { scope, organizationId } = input;
    if (
      scope.kind === "TEAM" &&
      !this.#teamsOf(organizationId).some((t) => t.id === scope.teamId)
    ) {
      throw new GatewayScopeOrgMismatchError("team");
    }
    if (scope.kind === "VIRTUAL_KEY") {
      const key = this.store.virtualKeys.get(scope.virtualKeyId);
      if (key?.organizationId !== organizationId || key.purpose !== "USER") {
        throw new VirtualKeyNotFoundError();
      }
    }
    if (scope.kind !== "ATTRIBUTED_USER") return;
    const anchors =
      Number(Boolean(scope.anchorVirtualKeyId)) + Number(Boolean(scope.anchorProjectId));
    if (anchors !== 1) throw new GatewayScopeOrgMismatchError("attributed-user anchor");
    if (scope.anchorVirtualKeyId) {
      const key = this.store.virtualKeys.get(scope.anchorVirtualKeyId);
      if (key?.organizationId !== organizationId || key.purpose !== "USER") {
        throw new GatewayScopeOrgMismatchError("virtual key");
      }
    }
  }

  async create(input: CreateBudgetInput): Promise<GatewayBudgetResource> {
    const cycleAnchorAt = input.cycleAnchorAt ?? null;
    if (cycleAnchorAt && !GatewayWindow.isCyclicWindow(input.window)) {
      throw new GatewayBudgetCycleAnchorInvalidError(input.window.toLowerCase());
    }
    await this.assertScopeWithinOrganization(input);
    if (
      input.providerKey &&
      !this.store.modelProviders.some(
        (provider) =>
          provider.id === input.providerKey && provider.organizationId === input.organizationId,
      )
    ) {
      throw new GatewayScopeOrgMismatchError("model provider");
    }

    const now = nowInstant();
    const projectId = input.scope.kind === "PROJECT" ? input.scope.projectId : null;
    const created = await this.store
      .atomically(async () => {
        const budget: GatewayBudget = {
          id: this.store.newId("gatewaybudget"),
          organizationId: input.organizationId,
          scopeType: input.scope.kind,
          scopeId: scopeIdOf(input.scope),
          providerKey: input.providerKey ?? null,
          name: input.name,
          description: input.description ?? null,
          window: input.window,
          limitUsd: memoryGatewayDecimal(input.limitUsd.toString()),
          onBreach: input.onBreach ?? "BLOCK",
          timezone: input.timezone ?? null,
          externalId: input.externalId ?? null,
          metadata: identityPatchData({ metadata: input.metadata }).metadata ?? {},
          spentUsd: memoryGatewayDecimal("0"),
          currentPeriodStartedAt: now,
          resetsAt: GatewayWindow.nextBoundaryFor({
            budget: { window: input.window, cycleAnchorAt },
          }),
          lastResetAt: null,
          cycleAnchorAt,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
          createdById: input.actorUserId,
          managedByVirtualKeyId: null,
        };
        this.#assertExternalIdFree(budget);
        this.store.budgets.set(budget.id, budget);
        await this.changes.append({
          organizationId: input.organizationId,
          projectId,
          kind: "BUDGET_CREATED",
          budgetId: budget.id,
        });
        await this.audit.append({
          organizationId: input.organizationId,
          projectId,
          actorUserId: input.actorUserId,
          action: "gateway.budget.created",
          targetKind: "budget",
          targetId: budget.id,
          after: auditRowOf(budget),
        });
        return budget;
      })
      .catch((error: unknown) => translateExternalIdConflict(error, "budget", input.externalId));

    return { ...created };
  }

  async update(input: UpdateBudgetInput): Promise<GatewayBudgetResource> {
    const existing = this.#stored(input);
    if (!existing) throw new GatewayBudgetNotFoundError();

    return this.store
      .atomically(async () => {
        const updated: GatewayBudget = {
          ...existing,
          name: input.name ?? existing.name,
          description: input.description === undefined ? existing.description : input.description,
          limitUsd:
            input.limitUsd === undefined
              ? existing.limitUsd
              : memoryGatewayDecimal(input.limitUsd.toString()),
          onBreach: input.onBreach ?? existing.onBreach,
          timezone: input.timezone === undefined ? existing.timezone : input.timezone,
          ...identityPatchData(input),
          updatedAt: nowInstant(),
        };
        this.#assertExternalIdFree(updated);
        this.store.budgets.set(updated.id, updated);
        await this.#recordChange({
          budget: updated,
          actorUserId: input.actorUserId,
          kind: "BUDGET_UPDATED",
          action: "gateway.budget.updated",
          before: auditRowOf(existing),
          after: auditRowOf(updated),
        });
        return { ...updated };
      })
      .catch((error: unknown) => translateExternalIdConflict(error, "budget", input.externalId));
  }

  async archive(input: ArchiveBudgetInput): Promise<GatewayBudgetResource> {
    const existing = this.#stored(input);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const now = nowInstant();
    const updated: GatewayBudget = { ...existing, archivedAt: now, updatedAt: now };
    this.store.budgets.set(updated.id, updated);
    await this.#recordChange({
      budget: updated,
      actorUserId: input.actorUserId,
      kind: "BUDGET_DELETED",
      action: "gateway.budget.deleted",
      before: auditRowOf(existing),
      after: auditRowOf(updated),
    });

    return { ...updated };
  }

  async reset(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    endUserId?: string | null;
    reason?: string | null;
  }): Promise<GatewayBudgetResource> {
    const existing = this.#stored(input);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const now = nowInstant();

    if (input.endUserId) {
      if (existing.scopeType !== "ATTRIBUTED_USER") {
        throw new GatewayScopeOrgMismatchError("attributed-user budget");
      }
      const bucketScopeId = bucketScopeIdFor(
        existing,
        attributedUserBucketScopeId(existing.scopeId, input.endUserId),
      );
      const key = boundaryKey(existing.id, bucketScopeId);
      const current = this.store.bucketBoundaries.get(key);
      this.store.bucketBoundaries.set(key, {
        id: current?.id ?? this.store.newId("gatewaybudgetbucketboundary"),
        organizationId: input.organizationId,
        budgetId: existing.id,
        bucketScopeId,
        periodStartedAt: now,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
      await this.audit.append({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "gateway.budget.reset",
        targetKind: "budget",
        targetId: existing.id,
        before: auditRowOf(existing),
        after: {
          row: auditRowOf(existing),
          resetBucketScopeId: bucketScopeId,
          resetReason: input.reason ?? null,
        },
      });
      return { ...existing };
    }

    // A reset forgives the spend so far without re-phasing an anchored cycle.
    const updated: GatewayBudget = {
      ...existing,
      currentPeriodStartedAt: now,
      lastResetAt: now,
      resetsAt: GatewayWindow.nextBoundaryFor({
        budget: { window: existing.window, cycleAnchorAt: existing.cycleAnchorAt },
        now,
      }),
      spentUsd: memoryGatewayDecimal("0"),
      updatedAt: now,
    };
    this.store.budgets.set(updated.id, updated);
    for (const [key, boundary] of this.store.bucketBoundaries) {
      if (boundary.budgetId === existing.id && boundary.organizationId === input.organizationId) {
        this.store.bucketBoundaries.delete(key);
      }
    }
    await this.#recordChange({
      budget: updated,
      actorUserId: input.actorUserId,
      kind: "BUDGET_UPDATED",
      action: "gateway.budget.reset",
      before: auditRowOf(existing),
      after: { row: auditRowOf(updated), resetReason: input.reason ?? null },
    });

    return { ...updated };
  }

  async check(input: GatewayBudgetCheckReadInput): Promise<BudgetCheckResult> {
    const projected = fixedPoint(input.projectedCostUsd.toString());
    const resolved = this.#resolve({
      organizationId: input.organizationId,
      teamId: input.teamId,
      projectId: input.projectId,
      virtualKeyId: input.virtualKeyId,
      principalUserId: input.principalUserId,
      memberGroupIds: input.memberGroupIds,
    }).filter((entry) => budgetAppliesToProvider(entry.budget, input.providerKey));
    const spends =
      input.tenantIds.length === 0
        ? []
        : await this.spend.findSpendForBudgetsAcrossTenants(
            input.tenantIds,
            resolved.map((entry) => ({
              budgetId: entry.budget.id,
              scope: entry.budget.scopeType,
              scopeId: entry.bucketScopeId,
              window: entry.budget.window,
              match: "exact" as const,
              periodFloorMs: computeBudgetPeriodFloorMs(entry.budget),
            })),
          );
    const spentByBudget = new Map(spends.map((spend) => [spend.budgetId, spend.spentUsd]));

    const result: BudgetCheckResult = {
      decision: "allow",
      warnings: [],
      blockReason: null,
      blockedBy: [],
      scopes: [],
    };
    for (const { budget } of resolved) {
      const spent = spentByBudget.get(budget.id) ?? "0";
      const spentFixed = memoryGatewayDecimal(spent, 9).toFixed(6);
      const limit = fixedPoint(budget.limitUsd.toString());
      const total = fixedPoint(spent) + projected;
      const pctUsed = percentUsed(total, limit);
      const scope = budget.scopeType.toLowerCase();
      result.scopes.push({
        scope,
        scopeId: budget.scopeId,
        window: budget.window.toLowerCase(),
        spentUsd: spentFixed,
        limitUsd: budget.limitUsd.toFixed(6),
      });
      const warning = { scope, pctUsed, limitUsd: budget.limitUsd.toString() };
      if (total >= limit && budget.onBreach === "BLOCK") {
        result.blockedBy.push({
          budgetId: budget.id,
          scope,
          scopeId: budget.scopeId,
          window: budget.window.toLowerCase(),
          limitUsd: budget.limitUsd.toString(),
          spentUsd: spentFixed,
        });
        result.blockReason ??= `Budget exceeded for scope=${scope} window=${budget.window.toLowerCase()}`;
      } else if (total >= limit || (pctUsed >= 80 && budget.onBreach === "BLOCK")) {
        result.warnings.push(warning);
      }
    }
    if (result.blockedBy.length > 0) result.decision = "hard_block";
    else if (result.warnings.length > 0) result.decision = "soft_warn";

    return result;
  }

  async findAttributedUserTemplates(input: {
    organizationId: string;
    virtualKeyId?: string;
  }): Promise<AttributedUserBudgetTemplate[]> {
    return this.#live(input.organizationId)
      .filter(
        (budget) =>
          budget.scopeType === "ATTRIBUTED_USER" &&
          (!input.virtualKeyId || budget.scopeId === input.virtualKeyId),
      )
      .map((budget) => ({
        id: budget.id,
        scopeType: budget.scopeType,
        scopeId: budget.scopeId,
        providerKey: budget.providerKey,
        window: budget.window,
        onBreach: budget.onBreach,
        limitUsd: budget.limitUsd,
        currentPeriodStartedAt: budget.currentPeriodStartedAt,
        resetsAt: budget.resetsAt,
        lastResetAt: budget.lastResetAt,
        cycleAnchorAt: budget.cycleAnchorAt,
      }));
  }

  async findBucketBoundaries(input: {
    organizationId: string;
    budgetIds: string[];
  }): Promise<BucketBoundaryRow[]> {
    const ids = new Set(input.budgetIds);
    return [...this.store.bucketBoundaries.values()]
      .filter((row) => row.organizationId === input.organizationId && ids.has(row.budgetId))
      .map(({ budgetId, bucketScopeId, periodStartedAt }) => ({
        budgetId,
        bucketScopeId,
        periodStartedAt,
      }));
  }

  /**
   * Budgets with their current-period ledger spend and per-person standings,
   * read at one instant; a failed ledger read leaves the stored figures and
   * says spend is unavailable rather than showing them as real.
   */
  async #withSpend(
    budgets: GatewayBudget[],
    input: GatewayOrganizationBudgetReadInput,
  ): Promise<{ budgets: GatewayBudgetWithSeats[]; spendAvailable: boolean; readAt: Instant }> {
    const now = nowInstant();
    if (budgets.length === 0 || input.tenantIds.length === 0) {
      return { budgets, spendAvailable: true, readAt: now };
    }
    try {
      const spends = await this.spend.findSpendForBudgetsAcrossTenants(
        input.tenantIds,
        budgets,
        now,
      );
      const seats = await this.#seatStandings({ budgets, input, now });
      const spendByBudget = new Map(spends.map((spend) => [spend.budgetId, spend]));
      return {
        spendAvailable: true,
        readAt: now,
        budgets: budgets.map((budget) => {
          const spend = spendByBudget.get(budget.id);
          const seat = seats.get(budget.id);
          const withSeats = seat
            ? { ...budget, endUsersSeen: seat.seen, endUsersOver: seat.over }
            : budget;
          return spend === undefined
            ? withSeats
            : {
                ...withSeats,
                spentNanoUsd: spend.spentNanoUsd,
                spentUsd: memoryGatewayDecimal(spend.spentUsd, 9),
              };
        }),
      };
    } catch (error) {
      logger.error(
        { organizationId: input.organizationId, budgetCount: budgets.length, error },
        "failed to read gateway budget spend totals",
      );
      return { budgets, spendAvailable: false, readAt: now };
    }
  }

  /** Per-person templates: people seen this period, and how many are at or over their cap. */
  async #seatStandings(args: {
    budgets: GatewayBudget[];
    input: GatewayOrganizationBudgetReadInput;
    now: Instant;
  }): Promise<Map<string, { seen: number; over: number }>> {
    const out = new Map<string, { seen: number; over: number }>();
    for (const budget of args.budgets) {
      if (budget.scopeType !== "ATTRIBUTED_USER") continue;
      const boundaries: BudgetBucketBoundary[] = [...this.store.bucketBoundaries.values()]
        .filter(
          (row) => row.organizationId === args.input.organizationId && row.budgetId === budget.id,
        )
        .map((row) => ({ bucketScopeId: row.bucketScopeId, periodStartedAt: row.periodStartedAt }));
      const buckets = await this.spend.findBucketSpendBreakdownForBudget({
        budget,
        tenantIds: args.input.tenantIds,
        boundaries,
        now: args.now,
      });
      const limitNanoUsd = usdToNanoUsd(budget.limitUsd);
      out.set(budget.id, {
        seen: buckets.length,
        over: buckets.filter((bucket) => BigInt(bucket.spentNanoUsd) >= limitNanoUsd).length,
      });
    }
    return out;
  }

  /** Every budget constraining the target, one entry per enforcement bucket, in a stable order. */
  #resolve(target: GatewayBudgetResolutionRead): GatewayResolvedBudget[] {
    const teamIds = presentIds([
      target.teamId,
      ...(target.scopedTeamIds ??
        (target.virtualKeyId
          ? (this.store.virtualKeys.get(target.virtualKeyId)?.scopes ?? [])
              .filter((scope) => scope.scopeType === "TEAM")
              .map((scope) => scope.scopeId)
          : [])),
    ]);
    const anchors = presentIds([target.virtualKeyId, target.projectId]);
    const applies = (budget: GatewayBudget): boolean => {
      switch (budget.scopeType) {
        case "ORGANIZATION":
          return budget.scopeId === target.organizationId;
        case "VIRTUAL_KEY":
          return Boolean(target.virtualKeyId) && budget.scopeId === target.virtualKeyId;
        case "TEAM":
          return teamIds.includes(budget.scopeId);
        case "PROJECT":
          return Boolean(target.projectId) && budget.scopeId === target.projectId;
        case "ATTRIBUTED_USER":
          return anchors.includes(budget.scopeId);
        case "PRINCIPAL":
          return Boolean(target.principalUserId) && budget.scopeId === target.principalUserId;
        case "GROUP":
          return Boolean(target.principalUserId) && target.memberGroupIds.includes(budget.scopeId);
      }
    };

    return this.#live(target.organizationId)
      .filter(applies)
      .map((budget): GatewayResolvedBudget => {
        if (budget.scopeType === "GROUP" && target.principalUserId) {
          return {
            budget,
            bucketScopeId: bucketScopeIdFor(
              budget,
              groupBucketScopeId(budget.scopeId, target.principalUserId),
            ),
            principalUserId: target.principalUserId,
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
      })
      .toSorted(
        (left, right) =>
          byCodeUnit(left.budget.scopeType, right.budget.scopeType) ||
          byCodeUnit(left.budget.id, right.budget.id) ||
          byCodeUnit(left.bucketScopeId, right.bucketScopeId),
      );
  }

  async #recordChange(input: {
    budget: GatewayBudget;
    actorUserId: string;
    kind: "BUDGET_UPDATED" | "BUDGET_DELETED";
    action: GatewayAuditAction;
    before: unknown;
    after: unknown;
  }): Promise<void> {
    await this.changes.append({
      organizationId: input.budget.organizationId,
      kind: input.kind,
      budgetId: input.budget.id,
    });
    await this.audit.append({
      organizationId: input.budget.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetKind: "budget",
      targetId: input.budget.id,
      before: input.before,
      after: input.after,
    });
  }

  #assertExternalIdFree(budget: GatewayBudget): void {
    if (budget.externalId === null) return;
    const taken = [...this.store.budgets.values()].some(
      (other) =>
        other.id !== budget.id &&
        other.organizationId === budget.organizationId &&
        other.externalId === budget.externalId,
    );
    if (taken) throw new MemoryGatewayUniqueConflictError(["organizationId", "externalId"]);
  }

  #stored(input: { id: string; organizationId: string }): GatewayBudget | undefined {
    const budget = this.store.budgets.get(input.id);
    return budget?.organizationId === input.organizationId ? budget : undefined;
  }

  #live(organizationId: string): GatewayBudget[] {
    return [...this.store.budgets.values()].filter(
      (budget) => budget.organizationId === organizationId && budget.archivedAt === null,
    );
  }

  /** Live budgets by scope kind, newest first within each, as the list reads them. */
  #listed(organizationId: string): GatewayBudget[] {
    return this.#live(organizationId).toSorted(
      (left, right) =>
        SCOPE_ORDER.indexOf(left.scopeType) - SCOPE_ORDER.indexOf(right.scopeType) ||
        Temporal.Instant.compare(right.createdAt, left.createdAt),
    );
  }

  #forProject(input: GatewayProjectBudgetReadInput): GatewayBudget[] {
    return this.#listed(input.organizationId).filter(
      (budget) =>
        (budget.scopeType === "ORGANIZATION" && budget.scopeId === input.organizationId) ||
        (budget.scopeType === "TEAM" && budget.scopeId === input.teamId) ||
        (budget.scopeType === "PROJECT" && budget.scopeId === input.projectId),
    );
  }

  #teamsOf(organizationId: string) {
    return this.store.teams.filter((team) => team.organizationId === organizationId);
  }

  #keysOf(organizationId: string) {
    return [...this.store.virtualKeys.values()].filter(
      (key) => key.organizationId === organizationId,
    );
  }
}

function newestFirst(budget: GatewayBudget): MemoryKeysetColumn[] {
  return [
    { value: budget.createdAt, direction: "desc" },
    { value: budget.id, direction: "desc" },
  ];
}

function boundaryKey(budgetId: string, bucketScopeId: string): string {
  return JSON.stringify([budgetId, bucketScopeId]);
}

/** The stored target id: the scope's own id, or the anchor a per-person template applies to. */
function scopeIdOf(scope: GatewayBudgetScope): string {
  switch (scope.kind) {
    case "ORGANIZATION":
      return scope.organizationId;
    case "TEAM":
      return scope.teamId;
    case "PROJECT":
      return scope.projectId;
    case "VIRTUAL_KEY":
      return scope.virtualKeyId;
    case "PRINCIPAL":
      return scope.principalUserId;
    case "GROUP":
      return scope.groupId;
    case "ATTRIBUTED_USER":
      return scope.anchorVirtualKeyId ?? scope.anchorProjectId ?? "";
  }
}

/** A budget row as the audit trail snapshots it: instants as the stored timestamps. */
function auditRowOf(budget: GatewayBudget) {
  const at = (instant: Instant | null) => (instant ? toDate(instant) : null);
  return serializeRowForAudit({
    ...budget,
    currentPeriodStartedAt: toDate(budget.currentPeriodStartedAt),
    resetsAt: toDate(budget.resetsAt),
    lastResetAt: at(budget.lastResetAt),
    cycleAnchorAt: at(budget.cycleAnchorAt),
    archivedAt: at(budget.archivedAt),
    createdAt: toDate(budget.createdAt),
    updatedAt: toDate(budget.updatedAt),
  });
}

function presentIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function byCodeUnit(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** A decimal string as an integer at {@link SCALE} places, for exact sums and comparisons. */
function fixedPoint(value: string): bigint {
  const text = /e/i.test(value) ? Number(value).toFixed(SCALE) : value.trim();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const magnitude =
    BigInt(whole || "0") * 10n ** BigInt(SCALE) +
    BigInt(fraction.padEnd(SCALE, "0").slice(0, SCALE) || "0");
  return negative ? -magnitude : magnitude;
}

/** Percent of the limit used, to two places rounded half up; a zero limit is fully used. */
function percentUsed(spent: bigint, limit: bigint): number {
  if (limit === 0n) return 100;
  const hundredths = spent * 10_000n;
  const quotient = hundredths / limit;
  const rounded = (hundredths % limit) * 2n >= limit ? quotient + 1n : quotient;
  return Number(rounded) / 100;
}
