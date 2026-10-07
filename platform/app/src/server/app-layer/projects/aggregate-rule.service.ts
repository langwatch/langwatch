import type { AggregateRule } from "./aggregate-rule";
import { AggregateRuleOutsideOrganizationError } from "./errors";
import type { AggregateRuleRepository } from "./repositories/aggregate-rule.repository";

/**
 * ADR-144 block D: what an aggregate project's rule means.
 *
 * {@link membersOf} is the one definition of membership. The reconciler
 * (block E) calls it to decide which project-reader grants should be live;
 * nothing else evaluates a rule, and no read ever asks it.
 */
export class AggregateRuleService {
  constructor(private readonly repository: AggregateRuleRepository) {}

  /**
   * Refuses a rule that names anything outside the organisation, before any
   * write. An explicit rule may name any live project of the organisation,
   * personal or not (ADR-144 decision 2); one id that is foreign, archived,
   * missing, the governance project or another aggregate refuses the whole
   * rule rather than being dropped, so the admin sees what they asked for or
   * an error, never a quietly shorter list.
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
        const belongs = await this.repository.departmentBelongsTo({
          organizationId,
          departmentId: rule.departmentId,
        });
        if (!belongs) throw new AggregateRuleOutsideOrganizationError();
        return;
      }
      case "explicit": {
        const named = new Set(rule.projectIds);
        const readable = await this.repository.findReadableProjectIds({
          organizationId,
          projectIds: [...named],
        });
        if (readable.length !== named.size) {
          throw new AggregateRuleOutsideOrganizationError();
        }
        return;
      }
    }
  }

  /**
   * The member project ids the rule resolves to today, sorted. Department
   * membership is the owner's current one. The aggregate itself is never its
   * own member, and an explicit id that has since been archived or moved out
   * simply stops being a member.
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
    const ids = await this.resolve({ rule, organizationId });
    return ids.filter((id) => id !== aggregateProjectId).sort();
  }

  private async resolve({
    rule,
    organizationId,
  }: {
    rule: AggregateRule;
    organizationId: string;
  }): Promise<string[]> {
    switch (rule.kind) {
      case "all-personal":
        return this.repository.findPersonalProjectIds({ organizationId });
      case "personal-by-department":
        return this.repository.findPersonalProjectIds({
          organizationId,
          departmentId: rule.departmentId,
        });
      case "explicit":
        return this.repository.findReadableProjectIds({
          organizationId,
          projectIds: [...new Set(rule.projectIds)],
        });
    }
  }
}
