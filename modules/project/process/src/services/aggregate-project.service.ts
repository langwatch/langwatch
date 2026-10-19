import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  AGGREGATE_DEFAULT_RULE,
  AggregateProjectAdminOnlyError,
  AggregateRuleOutsideOrganizationError,
  PROJECT_KIND,
  ProjectNotFoundError,
  isAggregateProjectRouteRefused,
  isAggregateProjectKind,
  type AggregateMemberCandidate,
  type AggregateRule,
  type AggregateRuleMembers,
} from "@langwatch/project-contract";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";

type AggregateProjectDependencies = Readonly<{
  repository: ProjectRepository;
  organizations: Pick<OrganizationApi, "isMember" | "getMember">;
  lifecycle: Pick<ProjectCreatedNoticeService, "aggregateRuleChanged">;
}>;

/**
 * ADR-177: project's half of aggregate projects. Project keeps `Project.aggregateRule`
 * and its reads (M8487-RULE-OWNER); governance's reconciler turns a rule into grants
 * after the answer, so an edit returns the rule's selected members as pending.
 */
export class AggregateProjectService {
  static create(dependencies: AggregateProjectDependencies): AggregateProjectService {
    return new AggregateProjectService(dependencies);
  }

  private constructor(private readonly dependencies: AggregateProjectDependencies) {}

  /**
   * The kind columns a new project is written with, checked before anything is:
   * none for an ordinary project; for an aggregate, an organisation admin and a valid rule.
   */
  async createFields(input: {
    organizationId: string;
    kind?: "application" | "aggregate" | undefined;
    aggregateRule?: AggregateRule | undefined;
    by: Readonly<{ id: string }>;
  }): Promise<{ kind?: "aggregate"; aggregateRule?: AggregateRule }> {
    if (!isAggregateProjectKind(input.kind)) return {};
    await this.#assertCanOpenAggregates({ organizationId: input.organizationId, by: input.by });
    const rule = input.aggregateRule ?? AGGREGATE_DEFAULT_RULE;
    await this.#assertValid({ rule, organizationId: input.organizationId });
    return { kind: PROJECT_KIND.AGGREGATE, aggregateRule: rule };
  }

  /** Replaces a live aggregate's rule and records the change governance reconciles from. */
  async updateRule(input: {
    projectId: string;
    aggregateRule: AggregateRule;
    by: Readonly<{ id: string }>;
  }): Promise<AggregateRuleMembers> {
    const current = await this.dependencies.repository.findWithTeam(input.projectId);
    if (!current || !isAggregateProjectKind(current.kind)) {
      throw new ProjectNotFoundError("Project not found");
    }
    const organizationId = current.team.organizationId;
    await this.#assertCanOpenAggregates({ organizationId, by: input.by });
    await this.#assertValid({ rule: input.aggregateRule, organizationId });
    await this.dependencies.repository.updateAggregateRule({
      id: input.projectId,
      organizationId,
      aggregateRule: input.aggregateRule,
    });
    await this.dependencies.lifecycle.aggregateRuleChanged({
      projectId: input.projectId,
      organizationId,
      changedByUserId: input.by.id,
    });
    const pending = await this.#selectedMembers({ rule: input.aggregateRule, organizationId });
    return {
      attached: [],
      revoked: [],
      unchanged: [],
      failed: [],
      pending: pending.filter((id) => id !== input.projectId),
    };
  }

  /** What an explicit rule may name, owners included: organisation admins only. */
  async candidateMembers(input: {
    organizationId: string;
    by: Readonly<{ id: string }>;
  }): Promise<AggregateMemberCandidate[]> {
    await this.#assertCanOpenAggregates(input);
    return this.dependencies.repository.findCandidateMembers({
      organizationId: input.organizationId,
    });
  }

  /** ADR-177 decision 5: opening an aggregate is decided on the organisation role alone. */
  async #assertCanOpenAggregates(input: {
    organizationId: string;
    by: Readonly<{ id: string }>;
  }): Promise<void> {
    const membership = { organizationId: input.organizationId, userId: input.by.id };
    const role = (await this.dependencies.organizations.isMember(membership))
      ? (await this.dependencies.organizations.getMember(membership)).role
      : undefined;
    if (isAggregateProjectRouteRefused({ kind: PROJECT_KIND.AGGREGATE, organizationRole: role })) {
      throw new AggregateProjectAdminOnlyError();
    }
  }

  /**
   * Main's `AggregateRuleService.assertValid`. A department rule is not checked
   * here: departments are governance's (handoff merge-8487-project-3a, Risks).
   */
  async #assertValid(input: { rule: AggregateRule; organizationId: string }): Promise<void> {
    if (input.rule.kind !== "explicit") return;
    const named = new Set(input.rule.projectIds);
    const readable = await this.dependencies.repository.findReadableProjectIds({
      organizationId: input.organizationId,
      projectIds: [...named],
    });
    if (readable.length !== named.size) throw new AggregateRuleOutsideOrganizationError();
  }

  /** The members project can name from its own rows; a department's are governance's to resolve. */
  #selectedMembers(input: { rule: AggregateRule; organizationId: string }): Promise<string[]> {
    switch (input.rule.kind) {
      case "all-personal":
        return this.dependencies.repository.findPersonalProjectIds({
          organizationId: input.organizationId,
        });
      case "personal-by-department":
        return Promise.resolve([]);
      case "explicit":
        return this.dependencies.repository.findReadableProjectIds({
          organizationId: input.organizationId,
          projectIds: [...new Set(input.rule.projectIds)],
        });
    }
  }
}
