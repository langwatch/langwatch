import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  AggregateRuleOutsideOrganizationError,
  type AggregateMemberCandidate,
  type AggregateRule,
} from "@langwatch/project-contract";

import type { AggregateRuleRepository } from "../repositories/aggregate-rule.repository.ts";

/**
 * ADR-175: what an aggregate project's rule means. {@link membersOf} is the one
 * definition of membership, which the reconciler asks and no read does.
 * Departments and owners are organisation's, read through its API.
 */
export class AggregateRuleService {
  readonly #repository: AggregateRuleRepository;
  readonly #organizations: Pick<OrganizationApi, "findMembersWithDepartments">;

  private constructor(
    repository: AggregateRuleRepository,
    organizations: Pick<OrganizationApi, "findMembersWithDepartments">,
  ) {
    this.#repository = repository;
    this.#organizations = organizations;
  }

  static create({
    repository,
    organizations,
  }: {
    repository: AggregateRuleRepository;
    organizations: Pick<OrganizationApi, "findMembersWithDepartments">;
  }): AggregateRuleService {
    return new AggregateRuleService(repository, organizations);
  }

  /**
   * Refuses a rule naming anything outside the organisation, before any write.
   * One foreign, archived, missing, governance or aggregate id refuses the whole
   * rule rather than being dropped, so the admin sees what they asked or an error.
   */
  async assertValid({
    rule,
    organizationId,
  }: {
    rule: AggregateRule;
    organizationId: string;
  }): Promise<void> {
    switch (rule.kind) {
      case "all-personal":
        return;
      case "personal-by-department": {
        const members = await this.#organizations.findMembersWithDepartments({ organizationId });
        if (!members.some((member) => member.departmentId === rule.departmentId)) {
          throw new AggregateRuleOutsideOrganizationError();
        }
        return;
      }
      case "explicit": {
        const named = new Set(rule.projectIds);
        const readable = await this.#repository.findReadableProjectIds({
          organizationId,
          projectIds: [...named],
        });
        if (readable.length !== named.size) throw new AggregateRuleOutsideOrganizationError();
        return;
      }
    }
  }

  /**
   * The projects an explicit rule of this organisation may name, which is
   * exactly what {@link assertValid} accepts. A personal workspace names its
   * owner; a shared project names none.
   */
  async candidateMembers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AggregateMemberCandidate[]> {
    const [projects, members] = await Promise.all([
      this.#repository.findCandidateProjects({ organizationId }),
      this.#organizations.findMembersWithDepartments({ organizationId }),
    ]);
    const owners = new Map(members.map((member) => [member.userId, member.user]));

    return projects.map(({ id, name, isPersonal, ownerUserId }) => {
      const owner = isPersonal && ownerUserId ? owners.get(ownerUserId) : void 0;
      return {
        id,
        name,
        isPersonal,
        owner: owner ? { name: owner.name, email: owner.email } : null,
      };
    });
  }

  /**
   * The member project ids the rule resolves to today, sorted. Department
   * membership is the owner's current one. The aggregate is never its own
   * member, and an explicit id since archived or moved out stops being one.
   */
  async membersOf({
    rule,
    organizationId,
    aggregateProjectId,
  }: {
    rule: AggregateRule;
    organizationId: string;
    aggregateProjectId?: string;
  }): Promise<string[]> {
    const ids = await this.#resolve({ rule, organizationId });
    return ids.filter((id) => id !== aggregateProjectId).toSorted();
  }

  async #resolve({
    rule,
    organizationId,
  }: {
    rule: AggregateRule;
    organizationId: string;
  }): Promise<string[]> {
    switch (rule.kind) {
      case "all-personal": {
        const personal = await this.#repository.findPersonalProjects({ organizationId });
        return personal.map((project) => project.id);
      }
      case "personal-by-department": {
        const [personal, members] = await Promise.all([
          this.#repository.findPersonalProjects({ organizationId }),
          this.#organizations.findMembersWithDepartments({ organizationId }),
        ]);
        const inDepartment = new Set(
          members
            .filter((member) => member.departmentId === rule.departmentId)
            .map((member) => member.userId),
        );
        return personal
          .filter((project) => project.ownerUserId && inDepartment.has(project.ownerUserId))
          .map((project) => project.id);
      }
      case "explicit":
        return this.#repository.findReadableProjectIds({
          organizationId,
          projectIds: [...new Set(rule.projectIds)],
        });
    }
  }
}
