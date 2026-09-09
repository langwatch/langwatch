/**
 * One member's own usage, as the /me dashboard reads it.
 *
 * The rollup itself is three reads the analytics store answers; what this
 * owns is which tenants they are asked about. A member's traffic lands in two
 * places — their personal project, and (for ingestion sources such as the
 * Claude Code OTLP exporter) the organization's hidden governance project,
 * under a PRINCIPAL-scope budget keyed on the user id. Resolving both is what
 * makes the screen's totals the member's whole spend rather than the half of
 * it that arrived through the gateway.
 *
 * A member with no personal workspace yet is answered with zeros rather than
 * a refusal: the page renders before their first request ever lands.
 */
import type {
  GovernanceService,
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageQueryInput,
  PersonalUsageSummary,
  PersonalUsageWindow,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";

/** The three answers one /me usage screen renders, resolved together. */
export type PersonalUsageRollup = {
  summary: PersonalUsageSummary;
  dailyBuckets: PersonalUsageBucket[];
  breakdownByModel: PersonalUsageBreakdown[];
};

/** Whose usage, over which window. Absent window means the store's default. */
export type PersonalUsageDashboardQuery = {
  userId: string;
  organizationId: string;
  window?: PersonalUsageWindow;
};

export type PersonalUsageDashboardServiceOptions = {
  governance: Pick<
    GovernanceService,
    "personalUsageSummary" | "personalUsageDailyBuckets" | "personalUsageBreakdownByModel"
  >;
  /** The member's personal workspace, which is the tenant their traces land in. */
  organizations: Pick<OrganizationService, "tryFindPersonalWorkspace">;
  /** The organization's hidden governance project, which ingestion rows land in. */
  projects: Pick<ProjectService, "tryFindInternal">;
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
    const workspace = await this.options.organizations.tryFindPersonalWorkspace({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    if (!workspace) {
      return nothingSpentYet();
    }

    // Read-only: a member reading their own dashboard must not provision the
    // organization's governance project. Absent, the union is simply the
    // personal tenant's own rows.
    const governanceProject = await this.options.projects.tryFindInternal({
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
   * The three reads behind one screen, issued together.
   *
   * They answer different questions and ClickHouse multiplexes them happily —
   * a caller awaiting them in sequence pays three round trips for one screen.
   * That is a fact about the store rather than about a door, so it is decided
   * here rather than in whichever door happens to ask.
   */
  async rollup(query: PersonalUsageQueryInput): Promise<PersonalUsageRollup> {
    const [summary, dailyBuckets, breakdownByModel] = await Promise.all([
      this.options.governance.personalUsageSummary(query),
      this.options.governance.personalUsageDailyBuckets(query),
      this.options.governance.personalUsageBreakdownByModel(query),
    ]);

    return { summary, dailyBuckets, breakdownByModel };
  }
}
