// Personal usage dashboard: resolves two tenants (personal project, org
// governance with PRINCIPAL-scope); returns zeros for new members.
import type {
  PersonalUsageQueryInput,
  PersonalUsageRollup,
  PersonalUsageWindow,
} from "@langwatch/enterprise-governance-contract";
import { type OrganizationService, TeamNotFoundError } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { DefaultGovernancePersonalUsageService } from "./personal-usage.service.ts";

/** Whose usage, over which window. Absent window means the store's default. */
export type PersonalUsageDashboardQuery = {
  userId: string;
  organizationId: string;
  window?: PersonalUsageWindow;
};

export type PersonalUsageDashboardServiceOptions = {
  usage: Pick<
    DefaultGovernancePersonalUsageService,
    "summary" | "dailyBuckets" | "breakdownByModel"
  >;
  /** The member's personal workspace, which is the tenant their traces land in. */
  organizations: Pick<OrganizationService, "getPersonalWorkspace">;
  /** The organization's hidden governance project, which ingestion rows land in. */
  projects: Pick<ProjectApi, "findInternal">;
};

/** What a member with no personal workspace yet is answered with. */
const nothingSpentYet = (): PersonalUsageRollup => ({
  summary: {
    spentUsd: 0,
    billedUsd: 0,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    mostUsedModel: null,
  },
  dailyBuckets: [],
  breakdownByModel: [],
});

export class PersonalUsageDashboardService {
  static create(options: PersonalUsageDashboardServiceOptions): PersonalUsageDashboardService {
    return new PersonalUsageDashboardService(options);
  }

  private constructor(private readonly options: PersonalUsageDashboardServiceOptions) {}

  /**
   * The member's usage in one organization: their personal tenant, unioned
   * with the ingestion rows recorded against them in the organization's
   * governance tenant.
   */
  async read(input: PersonalUsageDashboardQuery): Promise<PersonalUsageRollup> {
    const workspace = await this.options.organizations
      .getPersonalWorkspace({
        userId: input.userId,
        organizationId: input.organizationId,
      })
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) {
      return nothingSpentYet();
    }

    // Read-only: a member reading their own dashboard must not provision the
    // organization's governance project. Absent, the union is simply the
    // personal tenant's own rows.
    const governanceProject = await this.options.projects.findInternal({
      organizationId: input.organizationId,
      kind: "internal_governance",
    });

    return this.rollup({
      personalProjectId: workspace.project.id,
      window: input.window,
      userId: input.userId,
      ingestionTenantId: governanceProject?.id,
    });
  }

  /**
   * The three reads behind one screen, issued together — ClickHouse
   * multiplexes them happily, but awaiting them in sequence pays three round
   * trips for one screen, a fact about the store decided here, not per caller.
   */
  async rollup(query: PersonalUsageQueryInput): Promise<PersonalUsageRollup> {
    const [summary, dailyBuckets, breakdownByModel] = await Promise.all([
      this.options.usage.summary(query),
      this.options.usage.dailyBuckets(query),
      this.options.usage.breakdownByModel(query),
    ]);

    return { summary, dailyBuckets, breakdownByModel };
  }
}
