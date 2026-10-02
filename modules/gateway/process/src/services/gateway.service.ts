import {
  GatewayBudgetScopeUnreachableError,
  GatewayScopeOrgMismatchError,
  gatewayBudgetCheckInputSchema,
  createGatewayBudgetInputSchema,
  resetGatewayBudgetInputSchema,
  updateGatewayBudgetInputSchema,
  type GatewayBudgetCheckInput,
  type GatewayBudgetCheckResult,
  type GatewayBudgetDetail,
  type GatewayBudgetHealth,
  type GatewayBudgetPageInput,
  type GatewayBudgetResource,
  type GatewayBudgetResolutionTarget,
  type GatewayBudgetScopeTarget,
  type GatewayBudgetScopeReachInput,
  type GatewayBudgetScopeReachResult,
  type GatewayBudgetWithSeats,
  type ArchiveGatewayCacheRuleInput,
  type ArchiveGatewayGuardrailInput,
  type CreateGatewayCacheRuleInput,
  type CreateGatewayGuardrailInput,
  type GatewayCacheRuleCursor,
  type GatewayCacheRuleResource,
  type GatewayConfigBundlePersistence,
  type GatewayConfigGuardrailAttachment,
  type GatewayGuardrailResource,
  type GatewayResolvedBudget,
  type ResetGatewayBudgetInput,
  type UpdateGatewayCacheRuleInput,
  type UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import {
  type GatewayBudgetRepository,
  type ArchiveBudgetInput,
  type BucketBoundaryRow,
  type BudgetCheckInput,
  type BudgetCheckResult,
  type BudgetListWithHealth,
  type BudgetPageWithHealth,
  type CreateBudgetInput,
  type UpdateBudgetInput,
  type GatewayBudgetScope,
} from "../repositories/gateway-budget.repository.ts";
import { isGroupNotFound, isMemberNotFound } from "../rules/gateway-organization-peer.rules.ts";
import { GatewayBudgetScopeReadService } from "./gateway-budget-scope-read.service.ts";
import type { GatewayCacheRuleService } from "./gateway-cache-rule.service.ts";
import type { GatewayGuardrailService } from "./gateway-guardrail.service.ts";

export type { GatewayBudgetScopeReachInput } from "@langwatch/gateway-contract";

/** The organization facts the budget lifecycle reads: groups, and who holds a membership. */
export type GatewayBudgetOrganizations = Pick<
  OrganizationApi,
  "getGroup" | "getMember" | "listGroupsForMember"
>;

/** The singular process-owned Gateway service for the full budget lifecycle. */
export class GatewayService {
  private readonly repository: GatewayBudgetRepository;
  private readonly projects: ProjectApi;
  private readonly organizations: GatewayBudgetOrganizations;
  private readonly cacheRules: GatewayCacheRuleService;
  private readonly guardrails: GatewayGuardrailService;
  private readonly scopes: GatewayBudgetScopeReadService;

  private constructor({
    repository,
    projects,
    organizations,
    cacheRules,
    guardrails,
  }: {
    repository: GatewayBudgetRepository;
    projects: ProjectApi;
    organizations: GatewayBudgetOrganizations;
    cacheRules: GatewayCacheRuleService;
    guardrails: GatewayGuardrailService;
  }) {
    this.repository = repository;
    this.projects = projects;
    this.organizations = organizations;
    this.cacheRules = cacheRules;
    this.guardrails = guardrails;
    this.scopes = GatewayBudgetScopeReadService.create({ repository, projects, organizations });
  }

  static create(input: {
    repository: GatewayBudgetRepository;
    projects: ProjectApi;
    organizations: GatewayBudgetOrganizations;
    cacheRules: GatewayCacheRuleService;
    guardrails: GatewayGuardrailService;
  }): GatewayService {
    return new GatewayService({
      repository: input.repository,
      projects: input.projects,
      organizations: input.organizations,
      cacheRules: input.cacheRules,
      guardrails: input.guardrails,
    });
  }

  async checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> {
    const parsed = gatewayBudgetCheckInputSchema.parse(input);
    const tenantIds = await this.listSpendTenantIds(parsed.organizationId);
    const memberGroupIds = await this.scopes.memberGroupIds(parsed);

    return this.repository.check({ ...parsed, tenantIds, memberGroupIds });
  }

  /** Compatibility name retained while callers migrate to checkBudget. */
  async check(input: BudgetCheckInput): Promise<BudgetCheckResult> {
    const tenantIds = await this.listSpendTenantIds(input.organizationId);
    const memberGroupIds = await this.scopes.memberGroupIds(input);

    return this.repository.check({ ...input, tenantIds, memberGroupIds });
  }

  async list(organizationId: string): Promise<GatewayBudgetWithSeats[]> {
    const tenantIds = await this.listSpendTenantIds(organizationId);

    return this.repository.findAll({ organizationId, tenantIds });
  }

  async listForProject(projectId: string): Promise<GatewayBudgetWithSeats[]> {
    const project = await this.projects.findWithTeam(projectId);
    if (!project) {
      return [];
    }

    const tenantIds = await this.listSpendTenantIds(project.team.organizationId);

    return this.repository.findForProject({
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      projectId: project.id,
      tenantIds,
    });
  }

  async listWithHealth(organizationId: string): Promise<BudgetListWithHealth> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    const result = await this.repository.findWithHealth({ organizationId, tenantIds });

    return this.scopes.withScopeReach(result, organizationId);
  }

  async listPageWithHealth(input: GatewayBudgetPageInput): Promise<BudgetPageWithHealth> {
    const tenantIds = await this.listSpendTenantIds(input.organizationId);
    const result = await this.repository.findPageWithHealth({ ...input, tenantIds });

    return this.scopes.withScopeReach(result, input.organizationId);
  }

  async listForProjectWithHealth(projectId: string): Promise<BudgetListWithHealth> {
    const project = await this.projects.findWithTeam(projectId);
    if (!project) {
      return {
        budgets: [],
        spendAvailable: true,
        readAt: nowInstant(),
        scopeReach: new Map(),
      };
    }

    const tenantIds = await this.listSpendTenantIds(project.team.organizationId);
    const result = await this.repository.findForProjectWithHealth({
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      projectId: project.id,
      tenantIds,
    });

    return this.scopes.withScopeReach(result, project.team.organizationId);
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetWithSeats | null> {
    const tenantIds = await this.listSpendTenantIds(organizationId);

    return this.repository.findById({ id, organizationId, tenantIds });
  }

  async findHealthById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetHealth | null> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    const result = await this.repository.findHealthById({
      id,
      organizationId,
      tenantIds,
    });
    if (!result) {
      return null;
    }

    const scopeReach = await this.scopeReach({
      organizationId,
      scope: { scopeType: result.budget.scopeType, scopeId: result.budget.scopeId },
    });

    return { ...result, unreachableByAnyKey: !scopeReach.reachable };
  }

  async findDetailById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetDetail | null> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    const detail = await this.repository.findDetailById({ id, organizationId, tenantIds });
    if (!detail) {
      return null;
    }

    const targets = await this.resolveScopeTargets([detail.budget], organizationId);
    const target = targets.get(`${detail.budget.scopeType}:${detail.budget.scopeId}`);

    return target ? { ...detail, scopeTarget: target } : detail;
  }

  scopeReach(input: GatewayBudgetScopeReachInput): Promise<GatewayBudgetScopeReachResult> {
    return this.scopes.scopeReach(input);
  }

  async create(input: CreateBudgetInput): Promise<GatewayBudgetResource> {
    const parsed = createGatewayBudgetInputSchema.parse(input);
    assertOrganizationScopeIsOwn(parsed);
    await this.assertProjectScopesBelongToOrganization(parsed);
    // Ownership before reach: a scope from another tenant is refused as that, never as unreachable.
    await this.repository.assertScopeWithinOrganization(parsed);
    await this.assertOrganizationScopesBelongToOrganization(parsed);
    await this.assertScopeIsReachable(parsed);

    return this.repository.create(parsed);
  }

  update(input: UpdateBudgetInput): Promise<GatewayBudgetResource> {
    return this.repository.update(updateGatewayBudgetInputSchema.parse(input) as UpdateBudgetInput);
  }

  archive(input: ArchiveBudgetInput): Promise<GatewayBudgetResource> {
    return this.repository.archive(input);
  }

  reset(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource> {
    return this.repository.reset(resetGatewayBudgetInputSchema.parse(input));
  }

  async resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]> {
    const memberGroupIds = await this.scopes.memberGroupIds(input);

    return this.repository.resolveApplicableBudgets({ ...input, memberGroupIds });
  }

  /** When each of these budgets' buckets last rolled over, for a boundary-aware spend read. */
  findBucketBoundaries(input: {
    organizationId: string;
    budgetIds: string[];
  }): Promise<BucketBoundaryRow[]> {
    return this.repository.findBucketBoundaries(input);
  }

  resolveScopeTargets(
    budgets: { scopeType: string; scopeId: string }[],
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>> {
    return this.scopes.resolveScopeTargets(budgets, organizationId);
  }

  listSpendTenantIds(organizationId: string): Promise<string[]> {
    return this.projects.listIdsByOrganization({ organizationId });
  }

  cacheRuleList(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.cacheRules.list(organizationId);
  }

  cacheRuleListPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]> {
    return this.cacheRules.listPage(input);
  }

  findCacheRule(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null> {
    return this.cacheRules.findById(input);
  }

  cacheRuleCreate(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.cacheRules.create(input);
  }

  cacheRuleUpdate(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.cacheRules.update(input);
  }

  cacheRuleArchive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.cacheRules.archive(input);
  }

  guardrailList(projectId: string): Promise<GatewayGuardrailResource[]> {
    return this.guardrails.list(projectId);
  }

  findGuardrail(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null> {
    return this.guardrails.findById(input);
  }

  guardrailCreate(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    return this.guardrails.create(input);
  }

  guardrailUpdate(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    return this.guardrails.update(input);
  }

  guardrailArchive(input: ArchiveGatewayGuardrailInput): Promise<void> {
    return this.guardrails.archive(input);
  }

  async loadConfigurationPersistence(input: {
    organizationId: string;
    traceProjectId: string | null;
    guardrailAttachments: GatewayConfigGuardrailAttachment[];
  }): Promise<GatewayConfigBundlePersistence> {
    const cacheRules = await this.cacheRules.listEnabledForOrganization(input.organizationId);
    if (!input.traceProjectId) {
      return { cacheRules, guardrails: [], attachments: [] };
    }

    const guardrails = await this.guardrails.listBundleEntries(input.traceProjectId);
    const availableGuardrailIds = new Set(guardrails.map((guardrail) => guardrail.id));
    const attachments = input.guardrailAttachments
      .map((attachment) => ({
        direction: attachment.direction,
        guardrailIds: attachment.guardrailIds.filter((id) => availableGuardrailIds.has(id)),
      }))
      .filter((attachment) => attachment.guardrailIds.length > 0);

    return { cacheRules, guardrails, attachments };
  }

  /** A PRINCIPAL or GROUP scope must name a person or group of the budget's own organization. */
  private async assertOrganizationScopesBelongToOrganization(
    input: CreateBudgetInput,
  ): Promise<void> {
    if (input.scope.kind === "PRINCIPAL") {
      // The named user must belong to the organization, or the budget would never
      // match their traffic (PRINCIPAL spans only their organization's keys).
      const isMember = await this.organizations
        .getMember({ organizationId: input.organizationId, userId: input.scope.principalUserId })
        .then(
          () => true,
          (error: unknown) => {
            if (isMemberNotFound(error)) return false;

            throw error;
          },
        );
      if (!isMember) {
        throw new GatewayScopeOrgMismatchError("user");
      }
    }

    if (input.scope.kind === "GROUP") {
      // The scope id is request-supplied: without this a caller could put a
      // per-member budget on another tenant's group.
      await this.organizations
        .getGroup({ organizationId: input.organizationId, groupId: input.scope.groupId })
        .catch((error: unknown) => {
          if (isGroupNotFound(error)) throw new GatewayScopeOrgMismatchError("group");

          throw error;
        });
    }
  }

  private async assertScopeIsReachable(input: CreateBudgetInput): Promise<void> {
    if (input.allowUnreachable) {
      return;
    }

    const kind = input.scope.kind;
    if (kind !== "TEAM" && kind !== "PROJECT" && kind !== "GROUP") {
      return;
    }

    const scope = toGatewayBudgetScope(input.scope);
    const reach = await this.scopeReach({ organizationId: input.organizationId, scope });
    if (reach.activeKeyCount === 0 || reach.reachable) {
      return;
    }

    const scopeType = unreachableScopeTypeOf(kind);

    throw new GatewayBudgetScopeUnreachableError({
      scopeType,
      reachableProjectIds: reach.reachableProjectIds,
    });
  }

  private async assertProjectScopesBelongToOrganization(input: CreateBudgetInput): Promise<void> {
    if (input.scope.kind === "PROJECT") {
      await this.assertProjectBelongsToOrganization(input.scope.projectId, input.organizationId);
    }

    if (input.scope.kind === "ATTRIBUTED_USER" && input.scope.anchorProjectId) {
      await this.assertProjectBelongsToOrganization(
        input.scope.anchorProjectId,
        input.organizationId,
      );
    }
  }

  private async assertProjectBelongsToOrganization(
    projectId: string,
    organizationId: string,
  ): Promise<void> {
    const project = await this.projects.findWithTeam(projectId);
    if (project?.team.organizationId !== organizationId) {
      throw new GatewayScopeOrgMismatchError("project");
    }
  }
}

/** A budget is filed under the caller's organization, so an org scope must name that one. */
function assertOrganizationScopeIsOwn(input: CreateBudgetInput): void {
  if (input.scope.kind === "ORGANIZATION" && input.scope.organizationId !== input.organizationId) {
    throw new GatewayScopeOrgMismatchError("organization");
  }
}

function toGatewayBudgetScope(input: CreateBudgetInput["scope"]): GatewayBudgetScope {
  switch (input.kind) {
    case "TEAM":
      return { scopeType: "TEAM", scopeId: input.teamId };
    case "PROJECT":
      return { scopeType: "PROJECT", scopeId: input.projectId };
    case "GROUP":
      return { scopeType: "GROUP", scopeId: input.groupId };
    default:
      throw new Error(`Scope ${input.kind} is not reach-checked`);
  }
}

export type {
  ArchiveBudgetInput,
  BudgetCheckInput,
  BudgetCheckResult,
  BudgetListWithHealth,
  CreateBudgetInput,
  GatewayBudgetWithSeats,
  UpdateBudgetInput,
};

function unreachableScopeTypeOf(kind: "TEAM" | "PROJECT" | "GROUP") {
  if (kind === "TEAM") return "team";
  return kind === "PROJECT" ? "project" : "group";
}
