import type { AnnotationApi } from "@langwatch/annotation-contract";
import { AuthUnavailableError, type AuthApi } from "@langwatch/auth-contract";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { GithubApi } from "@langwatch/github-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import {
  USAGE_REPORT_SCHEMA_VERSION,
  USAGE_REPORT_SWITCHES_ON,
  type UsageReportSwitches,
} from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type {
  StoredObjectApi,
  StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The report's word for each destination, as the field has always named it. */
const STORAGE_BACKEND: Record<StoredObjectStorageDestination["kind"], string> = {
  s3: "s3",
  file: "local",
  azure: "azure",
};

/** What the deployment says about itself, supplied by the process. */
export interface UsageReportDeployment {
  readonly version: string;
  readonly installMethod: string;
  readonly chartVersion: string | undefined;
  readonly environment: string;
  readonly hostname: string | undefined;
  /** Left out of the report until its owner answers it. */
  readonly gatewayConfigured?: boolean;
}

/** Every module that owns a figure, asked through its own `countUsage`. */
export interface UsageReportPeers {
  readonly organizations: Pick<OrganizationApi, "countUsage">;
  readonly projects: Pick<ProjectApi, "listIdsByOrganization" | "countUsage">;
  readonly users: Pick<UserApi, "countUsage">;
  readonly auth: Pick<AuthApi, "countUsage" | "resolveAuthProvider">;
  readonly datasets: Pick<DatasetApi, "countUsage">;
  readonly annotations: Pick<AnnotationApi, "countUsage">;
  readonly monitors: Pick<MonitorApi, "countUsage">;
  readonly experiments: Pick<ExperimentApi, "countUsage">;
  readonly prompts: Pick<PromptApi, "countUsage">;
  readonly workflows: Pick<WorkflowApi, "countUsage">;
  readonly automations: Pick<AutomationApi, "countUsage">;
  readonly github: Pick<GithubApi, "countUsage">;
  readonly langy: Pick<LangyApi, "countUsage">;
  readonly dashboards: Pick<DashboardApi, "countUsage">;
  readonly modelProviders: Pick<ModelProviderApi, "countUsage">;
  readonly traces: Pick<TraceApi, "countUsage">;
  readonly scenarios: Pick<ScenarioApi, "countUsage">;
  readonly gateway: Pick<GatewayApi, "countUsage">;
  readonly instantEvals: Pick<InstantEvalApi, "countUsage">;
  readonly codingAgents: Pick<CodingAgentApi, "countUsage">;
  readonly mail: Pick<NotificationApi, "getMailDelivery">;
  readonly storage: Pick<StoredObjectApi, "getStorageDestination">;
}

export interface UsageReportCollectionServiceDependencies {
  readonly peers: UsageReportPeers;
  readonly deployment: () => UsageReportDeployment;
}

export interface UsageReportCollectInput {
  readonly organizationIds: readonly string[];
  readonly instanceId: string;
  readonly firstSeenAt: Instant | undefined;
  /** Whether any license on this install names a hosted service. */
  readonly connected: boolean;
  readonly switches?: UsageReportSwitches;
  readonly now: Instant;
}

/** One answer, taken lifetime and from each window's start (epoch ms). */
interface Windowed<T> {
  readonly lifetime: T;
  readonly sevenDays: T;
  readonly twentyEightDays: T;
}

interface Scope {
  readonly organizationIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly sevenDays: number;
  readonly twentyEightDays: number;
}

/**
 * The report one install sends, built from the dictionary (ADR-156, section
 * 10). Every figure comes from the module that owns it. Switching the optional
 * category off leaves the release and the size of the install, and nothing more.
 */
export class UsageReportCollectionService {
  private constructor(private readonly deps: UsageReportCollectionServiceDependencies) {}

  static create(deps: UsageReportCollectionServiceDependencies): UsageReportCollectionService {
    return new UsageReportCollectionService(deps);
  }

  async collect({
    organizationIds,
    instanceId,
    firstSeenAt,
    connected,
    switches = USAGE_REPORT_SWITCHES_ON,
    now,
  }: UsageReportCollectInput): Promise<Record<string, unknown>> {
    if (organizationIds.length === 0) {
      throw new Error("an install with no organization has nothing to report");
    }
    const scope = await this.scopeOf({ organizationIds, now });
    const [operational, optional] = await Promise.all([
      this.operational({ scope, connected }),
      switches.optional ? this.optional({ scope, switches, now }) : Promise.resolve({}),
    ]);
    const deployment = this.deps.deployment();

    return {
      instance_id: instanceId,
      report_schema_version: USAGE_REPORT_SCHEMA_VERSION,
      version: deployment.version,
      install_method: deployment.installMethod,
      chart_version: deployment.chartVersion ?? null,
      environment: deployment.environment,
      first_seen_at: firstSeenAt ? iso(firstSeenAt.epochMilliseconds) : null,
      timestamp: iso(now.epochMilliseconds),
      ...operational,
      ...optional,
    };
  }

  /**
   * One organization's own figures, for a caller who is not an install admin. What only
   * the whole install can answer (its identity, release, hostname, sign-in, mail, storage,
   * email domains and signed-in users) is left out rather than shown install-wide.
   */
  async collectForOrganization({
    organizationId,
    now,
  }: {
    organizationId: string;
    now: Instant;
  }): Promise<Record<string, unknown>> {
    const { peers } = this.deps;
    const scope = await this.scopeOf({ organizationIds: [organizationId], now });
    const [organizations, stored, ingested, providers] = await Promise.all([
      peers.organizations.countUsage({ organizationIds: scope.organizationIds }),
      scope.projectIds.length > 0 ? this.stored(scope) : Promise.resolve({}),
      this.ingested(scope),
      peers.modelProviders.countUsage({ organizationIds: scope.organizationIds }),
    ]);

    return {
      report_schema_version: USAGE_REPORT_SCHEMA_VERSION,
      timestamp: iso(now.epochMilliseconds),
      organizations: scope.organizationIds.length,
      teams: organizations.teams,
      projects: scope.projectIds.length,
      users: organizations.members,
      sso_provider: organizations.ssoProviders[0] ?? null,
      ...stored,
      ...ingested,
      model_providers: providers.providers.toSorted(),
    };
  }

  private async scopeOf({
    organizationIds,
    now,
  }: {
    organizationIds: readonly string[];
    now: Instant;
  }): Promise<Scope> {
    const projectIds = (
      await Promise.all(
        organizationIds.map((organizationId) =>
          this.deps.peers.projects.listIdsByOrganization({ organizationId }),
        ),
      )
    ).flat();
    return {
      organizationIds,
      projectIds,
      sevenDays: now.epochMilliseconds - 7 * DAY_MS,
      twentyEightDays: now.epochMilliseconds - 28 * DAY_MS,
    };
  }

  private async operational({
    scope,
    connected,
  }: {
    scope: Scope;
    connected: boolean;
  }): Promise<Record<string, unknown>> {
    const { organizationIds } = scope;
    const [organizations, [authMethod]] = await Promise.all([
      this.deps.peers.organizations.countUsage({ organizationIds }),
      this.findAuthMethods(),
    ]);
    return {
      organizations: organizationIds.length,
      teams: organizations.teams,
      projects: scope.projectIds.length,
      users: organizations.members,
      ...(authMethod === undefined ? {} : { auth_method: authMethod }),
      // The first provider named: an install with two is still an install using SSO.
      sso_provider: organizations.ssoProviders[0] ?? null,
      connected,
    };
  }

  /**
   * An install with no project yet has nothing project-scoped to count, and
   * the tenancy guard refuses an empty project list: those figures are left
   * out, and the organization's own fields still go.
   */
  private async optional({
    scope,
    switches,
    now,
  }: {
    scope: Scope;
    switches: UsageReportSwitches;
    now: Instant;
  }): Promise<Record<string, unknown>> {
    const { peers } = this.deps;
    const [stored, signedIn, domains, providers, ingested, mail, [storageBackend]] =
      await Promise.all([
        scope.projectIds.length > 0 ? this.stored(scope) : Promise.resolve({}),
        // An unexpired session is a recent sign-in; one person on four devices is one.
        scope.projectIds.length > 0
          ? peers.auth.countUsage({ at: now.epochMilliseconds })
          : Promise.resolve(undefined),
        peers.users.countUsage(),
        peers.modelProviders.countUsage({ organizationIds: scope.organizationIds }),
        this.ingested(scope),
        peers.mail.getMailDelivery(),
        this.findStorageBackends(scope),
      ]);
    const deployment = this.deps.deployment();

    return {
      ...stored,
      ...(signedIn === undefined ? {} : { active_users_28d: signedIn.signedInUsers }),
      ...ingested,
      user_email_domains: domains.emailDomains,
      ...(switches.hostname ? { hostname: deployment.hostname ?? null } : {}),
      // Names only: a key, an endpoint and a deployment name never travel.
      model_providers: providers.providers.toSorted(),
      ...(storageBackend === undefined ? {} : { storage_backend: storageBackend }),
      email_configured: mail.provider !== undefined,
      ...(deployment.gatewayConfigured === undefined
        ? {}
        : { gateway_configured: deployment.gatewayConfigured }),
    };
  }

  /** The sign-in the install offers; empty where this process composes no sign-in mode. */
  private async findAuthMethods(): Promise<string[]> {
    try {
      return [await this.deps.peers.auth.resolveAuthProvider()];
    } catch (error) {
      if (error instanceof AuthUnavailableError) return [];
      throw error;
    }
  }

  /** Where the install's first project writes its objects; empty before any project exists. */
  private async findStorageBackends({ projectIds }: Scope): Promise<string[]> {
    const [projectId] = projectIds;
    if (projectId === undefined) return [];
    const destination = await this.deps.peers.storage.getStorageDestination({ projectId });
    return [STORAGE_BACKEND[destination.kind]];
  }

  /** What the relational owners hold: windowed figures, lifetime totals and the ladder. */
  private async stored(scope: Scope) {
    const { peers } = this.deps;
    const { projectIds, organizationIds } = scope;
    const byProject = <T>(
      read: (input: { projectIds: readonly string[]; since?: number }) => Promise<T>,
    ) => inWindows(scope, (since) => read({ projectIds, ...since }));

    const [
      datasets,
      annotations,
      monitors,
      experiments,
      prompts,
      workflows,
      automations,
      langy,
      pullRequests,
      projects,
      organizations,
      dashboards,
      modelProviders,
    ] = await Promise.all([
      byProject((input) => peers.datasets.countUsage(input)),
      byProject((input) => peers.annotations.countUsage(input)),
      byProject((input) => peers.monitors.countUsage(input)),
      byProject((input) => peers.experiments.countUsage(input)),
      byProject((input) => peers.prompts.countUsage(input)),
      byProject((input) => peers.workflows.countUsage(input)),
      byProject((input) => peers.automations.countUsage(input)),
      byProject((input) => peers.langy.countUsage(input)),
      // Windowed on the day a pull request was opened, not the day it was noticed.
      inWindows(scope, (since) => peers.github.countUsage({ organizationIds, ...since })),
      Promise.all([
        peers.projects.countUsage({ organizationIds }),
        peers.projects.countUsage({ organizationIds, since: scope.twentyEightDays }),
      ]),
      peers.organizations.countUsage({ organizationIds }),
      peers.dashboards.countUsage({ projectIds }),
      peers.modelProviders.countUsage({ organizationIds }),
    ]);
    const [projectsLifetime, projectsRecent] = projects;

    return {
      annotationQueues: annotations.lifetime.annotationQueues,
      annotationQueueItems: annotations.lifetime.annotationQueueItems,
      annotationScores: annotations.lifetime.annotationScores,
      customGraphs: dashboards.builderCharts,
      ...windowed("annotations", annotations, (count) => count.annotations),
      ...windowed("batch_evaluations", datasets, (count) => count.batchEvaluations),
      ...windowed("datasets", datasets, (count) => count.datasets),
      ...windowed("dataset_records", datasets, (count) => count.datasetRecords),
      ...windowed("experiments", experiments, (count) => count.experiments),
      ...windowed("prompts", prompts, (count) => count.prompts),
      ...windowed("monitors", monitors, (count) => count.monitors),
      ...windowed("workflows", workflows, (count) => count.workflows),
      ...windowed("triggers", automations, (count) => count.triggers),
      ...windowed("pull_requests", pullRequests, (count) => count.pullRequests),
      ...windowed("langy_turns", langy, (count) => count.turns),
      ...windowed("langy_active_users", langy, (count) => count.activeUsers),
      ...rung("first_project_at", projectsLifetime.firstProjectAt),
      ...rung("first_member_at", organizations.secondMemberJoinedAt),
      ...rung("first_dataset_at", datasets.lifetime.firstDatasetAt),
      ...rung("first_evaluation_at", datasets.lifetime.firstBatchEvaluationAt),
      ...rung("first_monitor_at", monitors.lifetime.firstMonitorAt),
      ...rung("first_prompt_at", prompts.lifetime.firstPromptAt),
      ...rung("first_workflow_at", workflows.lifetime.firstWorkflowAt),
      ...rung("first_model_provider_at", modelProviders.firstModelProviderAt),
      ...rung("first_annotation_at", annotations.lifetime.firstAnnotationAt),
      ...rung("first_trigger_at", automations.lifetime.firstTriggerAt),
      ...rung("first_experiment_at", experiments.lifetime.firstExperimentAt),
      ...rung("first_langy_turn_at", langy.lifetime.firstTurnAt),
      active_projects_28d: projectsRecent.updatedProjects,
    };
  }

  /** What ClickHouse holds: each figure lifetime and in both windows, each rung its first day. */
  private async ingested(scope: Scope): Promise<Record<string, unknown>> {
    const { peers } = this.deps;
    const { projectIds } = scope;
    const byProject = <T>(
      read: (input: { projectIds: readonly string[]; since?: number }) => Promise<T>,
    ) => inWindows(scope, (since) => read({ projectIds, ...since }));

    const [traces, scenarios, instantEvals, codingAgents, gateway] = await Promise.all([
      byProject((input) => peers.traces.countUsage(input)),
      byProject((input) => peers.scenarios.countUsage(input)),
      byProject((input) => peers.instantEvals.countUsage(input)),
      byProject((input) => peers.codingAgents.countUsage(input)),
      byProject((input) => peers.gateway.countUsage(input)),
    ]);

    return {
      ...windowed("traces", traces, (count) => count.traces),
      ...windowed("scenario_runs", scenarios, (count) => count.runs),
      ...windowed("spans", traces, (count) => count.spans),
      ...windowed("instant_eval_runs", instantEvals, (count) => count.runs),
      ...windowed("instant_eval_judgments", instantEvals, (count) => count.judgments),
      ...windowed("coding_agent_sessions", codingAgents, (count) => count.sessions),
      ...windowed("gateway_requests", gateway, (count) => count.requests),
      ...windowed("gateway_spend_usd", gateway, (count) => count.spendUsd),
      ...rung("first_gateway_request_at", gateway.lifetime.firstRequestAt),
      ...rung("first_instant_eval_run_at", instantEvals.lifetime.firstRunAt),
      ...rung("first_coding_agent_session_at", codingAgents.lifetime.firstSessionAt),
    };
  }
}

/** Where a lifetime total already had a name on the wire before the windows existed. */
const LIFETIME_KEYS: Readonly<Record<string, string>> = {
  traces: "totalTraces",
  scenario_runs: "totalScenarioEvents",
  batch_evaluations: "batchEvaluations",
  dataset_records: "datasetRecords",
  langy_active_users: "langy_users",
};

async function inWindows<T>(
  scope: Scope,
  read: (since: { since?: number }) => Promise<T>,
): Promise<Windowed<T>> {
  const [lifetime, sevenDays, twentyEightDays] = await Promise.all([
    read({}),
    read({ since: scope.sevenDays }),
    read({ since: scope.twentyEightDays }),
  ]);
  return { lifetime, sevenDays, twentyEightDays };
}

/** One figure under its three dictionary keys. */
function windowed<T>(
  key: string,
  answer: Windowed<T>,
  pick: (count: T) => number,
): Record<string, number> {
  return {
    [LIFETIME_KEYS[key] ?? key]: pick(answer.lifetime),
    [`${key}_7d`]: pick(answer.sevenDays),
    [`${key}_28d`]: pick(answer.twentyEightDays),
  };
}

/** The wire's timestamp shape: ISO 8601 with milliseconds, as the report has always sent. */
function iso(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}

/** A rung of getting started: the day it was reached, or null on the wire where it never was. */
function rung(key: string, epochMilliseconds: number | undefined): Record<string, string | null> {
  return { [key]: epochMilliseconds === undefined ? null : iso(epochMilliseconds) };
}
