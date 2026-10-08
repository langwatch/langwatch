import type { AggregateRule } from "./aggregate-rule";
import { AggregateRuleOutsideOrganizationError } from "./errors";
import type {
  AggregateMemberCandidate,
  AggregateRuleRepository,
} from "./repositories/aggregate-rule.repository";

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
   * write. A rule may name any live project of the organisation, personal or
   * not (ADR-144 decision 2), whether as an explicit list or on top of the
   * personal workspaces; one id that is foreign, archived, missing, the
   * governance project or another aggregate refuses the whole rule rather
   * than being dropped, so the admin sees what they asked for or an error,
   * never a quietly shorter list.
   */
  async assertValid({
    rule,
    organizationId,
  }: {
    rule: AggregateRule;
    organizationId: string;
  }): Promise<void> {
    if (rule.kind === "personal-by-department") {
      const belongs = await this.repository.departmentBelongsTo({
        organizationId,
        departmentId: rule.departmentId,
      });
      if (!belongs) throw new AggregateRuleOutsideOrganizationError();
    }
    if (!rule.projectIds) return;
    const named = new Set(rule.projectIds);
    const readable = await this.repository.findReadableProjectIds({
      organizationId,
      projectIds: [...named],
    });
    if (readable.length !== named.size) {
      throw new AggregateRuleOutsideOrganizationError();
    }
  }

  /**
   * The projects a rule of this organisation may name, which is
   * exactly what {@link assertValid} accepts: every live project of any
   * ordinary kind, personal workspaces of every member included. The
   * new-project form offers these and nothing else, so a pick it offers is
   * never refused as outside the organisation.
   */
  async candidateMembers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AggregateMemberCandidate[]> {
    return this.repository.findCandidateMembers({ organizationId });
  }

  /**
   * The member project ids the rule resolves to today, sorted. Department
   * membership is the owner's current one. A personal rule's named projects
   * are read on top of its personal workspaces. The aggregate itself is never
   * its own member, and a named id that has since been archived or moved out
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
    const [personal, named] = await Promise.all([
      this.resolvePersonal({ rule, organizationId }),
      rule.projectIds
        ? this.repository.findReadableProjectIds({
            organizationId,
            projectIds: [...new Set(rule.projectIds)],
          })
        : [],
    ]);
    return [...new Set([...personal, ...named])];
  }

  /** The personal workspaces the rule covers by kind, before any named ones. */
  private resolvePersonal({
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
        return Promise.resolve([]);
    }
  }
}
