import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";
import type { Instant } from "@langwatch/time";
import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "@langwatch/trace-contract";
/**
 * The billing entitlement decision required to present coding-agent costs.
 * Composition selects the policy; callers do not supply a partial entitlement
 * view or individual callbacks.
 */
export interface CodingAgentBillingPolicy {
  isSourceNonBillable(input: { organizationId: string; sourceType: string }): Promise<boolean>;
}

/** One project of an organization, as the scope rule reads it. */
export type CodingAgentScopeProject = Readonly<{
  id: string;
  name: string;
  slug: string;
  teamId: string;
  /** Whether the project is one person's workspace rather than a shared one. */
  isPersonal: boolean;
}>;

/**
 * The organization's projects, and the person behind each personal workspace.
 * The project list is enumerated from the ORGANIZATION, never from a request,
 * so a caller cannot count a project by naming one it may not read.
 */
export interface CodingAgentCallerScopeDirectory {
  /** Every live project of one organization. */
  listOrganizationProjects(input: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]>;

  /**
   * Who each personal workspace belongs to, keyed by team id. Asked only for
   * personal teams, never a shared one — a shared team's members answer
   * nothing displays, so reading them would cost a query for nothing.
   */
  listPersonalTeamOwnerNames(input: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

/** The two cuts a pull-request rollup is resolved over. */
export type CodingAgentScopePermission = "traces:view" | "cost:view";

// Cross-project cut resolver; API keys may narrow holder's access, so scope
// resolved from key's bindings, not holder's; SERVICE keys have no user.
export type CodingAgentScopeCaller =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "apiKey"; readonly apiKeyId: string; readonly userId: string | null };

/** Batch permission resolution; absent answers deny. */
export interface CodingAgentScopePermissions {
  projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>>;
}

/** The package clock keeps time-dependent read and persistence rules testable. */
export interface CodingAgentClock {
  nowMs(): number;
}

/** Static cost pricing for sessions; reduces dependencies in the worker. */
export interface CodingAgentCostEstimator {
  /** Prices one model call from its token facts. */
  estimateCost(input: ModelCostEstimateInput): number;
}

export type CodingAgentCostMetric = {
  eventId: string;
  agent: string;
  model: string;
  valueUsd: number;
};

export interface CodingAgentCostMetrics {
  recordComputed(input: CodingAgentCostMetric): void;
  recordReported(input: CodingAgentCostMetric): void;
}

/** Single throttled write to mark projects as having seen agent activity. */
export interface CodingAgentProjectActivity {
  /**
   * Records that this project has just seen coding-agent session activity.
   * The staleness window it's throttled by belongs to the implementation, not
   * the caller — both graphs must skip the same writes, not merely agree by chance.
   */
  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

/** GitHub demand path; answers two questions for the mapping subscriber. */
export interface CodingAgentPullRequestMapping {
  /** Whether this instance's GitHub App can answer for that repository host. */
  canMapRepositoryHost(repositoryHost: string): boolean;

  /** Asks the organization's connection which pull requests host this branch. */
  requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void>;
}

export type CodingAgentSessionListReadOutcome = "hit" | "empty" | "error";

/** Observes the bounded session-list storage read without coupling the feature to app metrics. */
export interface CodingAgentReadMetrics {
  observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void;
}

export interface CodingAgentTraceProcessor {
  normalizeSpan(input: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan;

  findNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null>;
}
