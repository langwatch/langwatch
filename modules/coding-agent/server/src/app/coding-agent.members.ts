import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";
import type { Instant } from "@langwatch/time";
import type { NormalizedSpan, OtlpInstrumentationScope, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
export interface CodingAgentInfrastructure {  codingAgentBillingPolicy: CodingAgentBillingPolicy;
  codingAgentCallerScopeDirectory: CodingAgentCallerScopeDirectory;
  codingAgentClock: CodingAgentClock;
  codingAgentCostEstimator: CodingAgentCostEstimator;
  codingAgentCostMetrics: CodingAgentCostMetrics;
  codingAgentProjectActivity: CodingAgentProjectActivity;
  codingAgentPullRequestMapping: CodingAgentPullRequestMapping;
  codingAgentReadMetrics: CodingAgentReadMetrics;
  codingAgentScopePermissions: CodingAgentScopePermissions;
  codingAgentTraceProcessing: CodingAgentTraceProcessor;
}

/**
 * The billing entitlement decision required to present coding-agent costs.
 * Composition selects the policy; callers do not supply a partial entitlement
 * view or individual callbacks.
 */
export interface CodingAgentBillingPolicy {
  isSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;
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
 *
 * The project list is enumerated from the ORGANIZATION and never taken from a
 * request: a caller that could name the projects to count could count one it
 * may not read.
 */
export interface CodingAgentCallerScopeDirectory {
  /** Every live project of one organization. */
  listOrganizationProjects(input: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]>;

  /**
   * Who each personal workspace belongs to, keyed by team id.
   *
   * Asked only for personal teams, and never for a shared one: a shared team's
   * members are not an answer to "who worked here", so reading them would cost
   * a query nothing displays.
   */
  listPersonalTeamOwnerNames(input: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

/** The two cuts a pull-request rollup is resolved over. */
export type CodingAgentScopePermission = "traces:view" | "cost:view";

/**
 * Who a cross-project cut is resolved for.
 *
 * A person reads with their own bindings. A CREDENTIAL reads with its own,
 * and that is not the same reach: a key can carry bindings NARROWER than its
 * holder's, which is the whole point of a restricted key, so a scope resolved
 * from the holder alone would let a deliberately narrowed key read with the
 * holder's full access. An organization SERVICE key owns no user at all - the
 * credential a continuous-integration job holds - and reads with its bindings
 * alone, which is what `userId: null` says.
 */
export type CodingAgentScopeCaller =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "apiKey"; readonly apiKeyId: string; readonly userId: string | null };

/**
 * Which of a set of projects one caller holds each permission on, answered in
 * a fixed number of queries rather than one per project.
 *
 * A batch rather than a probe per project on purpose, and ONE batch for both
 * permissions rather than one each: the cuts run over every project in an
 * organization, and a fan-out of individual decisions is what starves the
 * connection pool on a large tenant. Two single-permission batches would
 * collect the same grant snapshot twice for the same answer.
 *
 * Absent answers deny. A project the batch did not answer for is refused
 * rather than assumed, so a short answer can only narrow the scope.
 */
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

/**
 * What a coding-agent session's cost is priced from.
 *
 * The fold used to take the whole `ModelProviderApi` — every provider row,
 * every default, every credential and the authorization service behind them —
 * to call this one method, and that method reads nothing but the platform's
 * immutable static cost registry: `estimateModelCost(input, staticCostRates())`
 * with no query, no tenant and no I/O. A worker that folds sessions needs the
 * pricing, not the graph, and naming the method here is what lets it compose
 * the pipeline without also composing the App's provider stack.
 *
 * `ModelProviderApi` satisfies it: the published service carries this
 * method with this signature, which is what keeps the frozen registration in
 * `platform/app` compiling.
 */
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

/**
 * The one project write a folded session performs.
 *
 * Storing a session stamps its project as having seen coding-agent activity,
 * so the settings surfaces can tell a project that has ever run an agent from
 * one that has not. It is a single throttled `UPDATE` against one column — and
 * to reach it the pipeline used to take the whole project application, which
 * is composed from a Prisma repository, an authorization service, a topic
 * clustering port, a credentials adapter and the transports' collaborators.
 * None of those is asked anything here.
 *
 * `ProjectApi` satisfies it: the module's application carries this method with
 * this signature, so a composition root hands its app straight over.
 */
export interface CodingAgentProjectActivity {
  /**
   * Records that this project has just seen coding-agent session activity.
   *
   * The staleness window the write is throttled by belongs to the
   * implementation, not the caller: both graphs must skip the same writes, and
   * a caller that named its own would make that a coincidence.
   */
  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

/**
 * The GitHub demand path, as the session fold's mapping subscriber uses it.
 *
 * The subscriber asks two questions and no more: whether a repository host is
 * one this instance's GitHub App can answer for, and — for a branch somebody
 * is looking at right now — which pull requests have hosted it. The published
 * `GithubService` carries thirty methods composed from an organization
 * service, a project service and both transports' collaborators, so taking it
 * whole is what kept this subscriber unmountable outside the App.
 *
 * `GithubService` satisfies it, and so does the branch-demand composition a
 * worker builds from its own database: both carry these two methods with these
 * signatures, which is what keeps the frozen registration in `platform/app`
 * compiling.
 */
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
