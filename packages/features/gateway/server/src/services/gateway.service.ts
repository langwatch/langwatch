import {
  GatewayBudgetScopeUnreachableError,
  GatewayScopeOrgMismatchError,
  GatewayService as GatewayServiceContract,
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
import type { ProjectService } from "@langwatch/project-contract";
import {
  GatewayBudgetRepository,
  type ArchiveBudgetInput,
  type BudgetCheckInput,
  type BudgetCheckResult,
  type BudgetListWithHealth,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from "../repositories/gateway-budget.repository";
import { type GatewayBudgetScope } from "../repositories/gateway-budget.repository";
import { GatewayBudgetScopeReachService } from "./gateway-budget-scope-reach.service";
import { GatewayCacheRulePersistence } from "./gateway-cache-rule.service";
import { GatewayGuardrailCatalogue } from "./gateway-guardrail.service";

export type { GatewayBudgetScopeReachInput } from "@langwatch/gateway-contract";

/** The singular process-owned Gateway service for the full budget lifecycle. */
export class GatewayService extends GatewayServiceContract {
  private readonly reachPolicy = GatewayBudgetScopeReachService.create();

  private constructor(
    private readonly repository: GatewayBudgetRepository,
    private readonly projects: ProjectService,
    private readonly cacheRules: GatewayCacheRulePersistence,
    private readonly guardrails: GatewayGuardrailCatalogue,
  ) {
    super();
  }

  static create(input: {
    repository: GatewayBudgetRepository;
    projects: ProjectService;
    cacheRules: GatewayCacheRulePersistence;
    guardrails: GatewayGuardrailCatalogue;
  }): GatewayService {
    return new GatewayService(input.repository, input.projects, input.cacheRules, input.guardrails);
  }

  async checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> {
    const parsed = gatewayBudgetCheckInputSchema.parse(input);
    const tenantIds = await this.listSpendTenantIds(parsed.organizationId);
    return this.repository.check({ ...parsed, tenantIds });
  }

  /** Compatibility name retained while callers migrate to checkBudget. */
  async check(input: BudgetCheckInput): Promise<BudgetCheckResult> {
    const tenantIds = await this.listSpendTenantIds(input.organizationId);
    return this.repository.check({ ...input, tenantIds });
  }

  async list(organizationId: string): Promise<GatewayBudgetWithSeats[]> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    return this.repository.list({ organizationId, tenantIds });
  }

  async listForProject(projectId: string): Promise<GatewayBudgetWithSeats[]> {
    const project = await this.projects.tryGetWithTeam(projectId);
    if (!project) {
      return [];
    }

    const tenantIds = await this.listSpendTenantIds(project.team.organizationId);
    return this.repository.listForProject({
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      projectId: project.id,
      tenantIds,
    });
  }

  async listWithHealth(organizationId: string): Promise<BudgetListWithHealth> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    const result = await this.repository.listWithHealth({ organizationId, tenantIds });
    return this.withScopeReach(result, organizationId);
  }

  async listPageWithHealth(input: GatewayBudgetPageInput): Promise<BudgetListWithHealth> {
    const tenantIds = await this.listSpendTenantIds(input.organizationId);
    const result = await this.repository.listPageWithHealth({ ...input, tenantIds });
    return this.withScopeReach(result, input.organizationId);
  }

  async listForProjectWithHealth(projectId: string): Promise<BudgetListWithHealth> {
    const project = await this.projects.tryGetWithTeam(projectId);
    if (!project) {
      return {
        budgets: [],
        spendAvailable: true,
        readAt: new Date(),
        scopeReach: new Map(),
      };
    }

    const tenantIds = await this.listSpendTenantIds(project.team.organizationId);
    const result = await this.repository.listForProjectWithHealth({
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      projectId: project.id,
      tenantIds,
    });
    return this.withScopeReach(result, project.team.organizationId);
  }

  async tryGet(id: string, organizationId: string): Promise<GatewayBudgetWithSeats | null> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    return this.repository.tryGet({ id, organizationId, tenantIds });
  }

  async tryGetWithHealth(id: string, organizationId: string): Promise<GatewayBudgetHealth | null> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    const result = await this.repository.tryGetWithHealth({
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

  async tryGetDetail(id: string, organizationId: string): Promise<GatewayBudgetDetail | null> {
    const tenantIds = await this.listSpendTenantIds(organizationId);
    const detail = await this.repository.tryGetDetail({ id, organizationId, tenantIds });
    if (!detail) {
      return null;
    }

    const targets = await this.resolveScopeTargets([detail.budget], organizationId);
    const target = targets.get(`${detail.budget.scopeType}:${detail.budget.scopeId}`);
    return target ? { ...detail, scopeTarget: target } : detail;
  }

  async scopeReach(input: GatewayBudgetScopeReachInput): Promise<GatewayBudgetScopeReachResult> {
    const candidates = await this.repository.listScopeReachCandidates(input.organizationId);
    const projectIds = candidates.flatMap((candidate) =>
      candidate.traceProjectId ? [candidate.traceProjectId] : [],
    );
    const traceProjects = await this.projects.listTraceDestinations(projectIds);
    return this.reachPolicy.resolveScope({
      candidates,
      traceProjects,
      scope: input.scope,
    });
  }

  async create(input: CreateBudgetInput): Promise<GatewayBudgetResource> {
    const parsed = createGatewayBudgetInputSchema.parse(input);
    await this.assertProjectScopesBelongToOrganization(parsed);
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

  resolveApplicableBudgets(input: GatewayBudgetResolutionTarget): Promise<GatewayResolvedBudget[]> {
    return this.repository.resolveApplicableBudgets(input);
  }

  async resolveScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>> {
    const projectIds = budgets
      .filter((budget) => budget.scopeType === "PROJECT" || budget.scopeType === "ATTRIBUTED_USER")
      .map((budget) => budget.scopeId);
    const virtualKeyIds = budgets
      .filter((budget) => budget.scopeType === "VIRTUAL_KEY")
      .map((budget) => budget.scopeId);
    const virtualKeyProjectScopes = await this.repository.listVirtualKeyProjectScopes({
      organizationId,
      virtualKeyIds,
    });
    const projects = await this.projects.listNamesByIds({
      projectIds: [
        ...new Set([...projectIds, ...virtualKeyProjectScopes.map((scope) => scope.projectId)]),
      ],
    });
    return this.repository.resolveScopeTargets(
      budgets,
      organizationId,
      projects,
      virtualKeyProjectScopes,
    );
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

  tryCacheRuleGet(id: string, organizationId: string): Promise<GatewayCacheRuleResource | null> {
    return this.cacheRules.tryGet(id, organizationId);
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

  tryGuardrailGet(id: string, projectId: string): Promise<GatewayGuardrailResource | null> {
    return this.guardrails.tryGet(id, projectId);
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

  private async withScopeReach(
    result: BudgetListWithHealth,
    organizationId: string,
  ): Promise<BudgetListWithHealth> {
    const candidates = await this.repository.listScopeReachCandidates(organizationId);
    const projectIds = candidates.flatMap((candidate) =>
      candidate.traceProjectId ? [candidate.traceProjectId] : [],
    );
    const traceProjects = await this.projects.listTraceDestinations(projectIds);
    const scopeReach = this.reachPolicy.resolveBudgets({
      candidates,
      traceProjects,
      budgets: result.budgets,
    });
    return { ...result, scopeReach };
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

    const scopeType = kind === "TEAM" ? "team" : kind === "PROJECT" ? "project" : "group";
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
    const project = await this.projects.tryGetWithTeam(projectId);
    if (project?.team.organizationId !== organizationId) {
      throw new GatewayScopeOrgMismatchError("project");
    }
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
