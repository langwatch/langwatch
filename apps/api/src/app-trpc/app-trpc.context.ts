/**
 * The request context every packaged tRPC surface on this process is resolved against.
 * Every mounted feature names its own context type, and each of those names one slice of
 * the host application plus, for a few, the authenticated session.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { LangyApp } from "@langwatch/langy-server";
import type { OpsApp } from "@langwatch/ops-server";
import type { ScenarioApp } from "@langwatch/scenario-server";
import type { SuiteApp } from "@langwatch/suite-server";
import type { AnnotationApp } from "@langwatch/annotation-server";
import type { ApiKeyApp } from "@langwatch/api-key-server";
import type { AutomationApp } from "@langwatch/automation-server";
import type { CodingAgentApp } from "@langwatch/coding-agent-server";
import type {
  EnterpriseTrpcContext,
  GovernanceApp,
  GovernanceService,
  OrganizationSessionPolicyService,
  WebhookApp,
} from "@langwatch/enterprise-api";
import type { GatewayApp } from "@langwatch/gateway-server";
import type { GithubService } from "@langwatch/github-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { AuthzApp } from "@langwatch/authz-server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { DashboardApp } from "@langwatch/dashboard-server";
import type { DatasetApp } from "@langwatch/dataset-server";
import type { EvaluatorApp } from "@langwatch/evaluator-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { OrganizationApp } from "@langwatch/organization-server";
import type { PresenceService } from "@langwatch/presence-contract";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ModelProviderApp } from "@langwatch/model-provider-server";
import type { MonitorApp } from "@langwatch/monitor-server";
import type { StoredObjectApp } from "@langwatch/stored-object-server";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import type { TraceApp } from "@langwatch/trace-server";
import type { ProjectApp } from "@langwatch/project-server";
import type { PromptApp } from "@langwatch/prompt-server";
import type { RoleApp } from "@langwatch/role-server";
import type { UserApp } from "@langwatch/user-server";
import type { WorkflowApp } from "@langwatch/workflow-server";

/**
 * The application slices the mounted surfaces read off `ctx.app`.
 */
export type ApiTrpcFeatureApplication = Readonly<{
  analytics: AnalyticsApp;
  annotations: AnnotationApp;
  apiKeys: ApiKeyApp;
  /**
   * A project's triggers, their channels and the addresses that asked those channels to
   * stop. One application for both wire names, because a suppression is a fact about a
   * trigger's delivery rather than a resource of its own.
   */
  automation: AutomationApp;
  /** What the coding agents did inside a project, as the read surfaces ask it. */
  codingAgentApp: CodingAgentApp;
  /** What the caller may do at one scope, as `authz.*` reports it back to them. */
  authzApp: AuthzApp;
  broadcast: PresenceEmitterPort;
  dashboard: DashboardApp;
  /**
   * A project's datasets, the rows inside them and the batch-evaluation
   * rollups over them. One application for all three surfaces, because a
   * project's rows are one set.
   */
  dataset: DatasetApp;
  /**
   * The evaluation command surface. `reportEvaluation` is a pipeline command
   * rather than a service method, which is why the feature names it
   * structurally and so does this.
   */
  evaluations: Readonly<{ reportEvaluation(data: never): Promise<unknown> }>;
  experiments: ExperimentApp;
  /**
   * The evaluators a project defines, and the model defaults one created
   * without a named model falls back to.
   */
  evaluatorApp: EvaluatorApp;
  /**
   * This deployment's flag store. Read by `featureFlag.*` and, through it, by
   * every rollout gate the browser asks about.
   */
  featureFlags: FeatureFlagService;
  /**
   * The AI Gateway's one application, as all six core gateway surfaces reach it.
   */
  gateway: GatewayApp;
  /**
   * The GitHub App an organization connected, as `github.*` reads it.
   */
  github: GithubService;
  /**
   * The Enterprise governance capability the console's ten surfaces read, and the `/`
   * landing decision reads the setup rollup from.
   */
  governance: GovernanceService;
  /**
   * The governance APPLICATION beside the capability: the personal virtual keys a member
   * mints and the routing policies their traffic follows.
   */
  governanceApp: GovernanceApp;
  /** The rules an organization bounds its members' sessions by. */
  sessionPolicy: OrganizationSessionPolicyService;
  /**
   * Where a spend event is delivered, as the endpoint surface registers and
   * lists them.
   */
  webhooks: WebhookApp;
  /**
   * The Langy conversation panel's one application — the slim spine, one conversation's
   * messages, the turn-start operation both doors share, and the project's egress
   * allow-list.
   */
  langy: LangyApp;
  /**
   * The operator back office, and the operator allow-list beside it. The WHOLE
   * application rather than the single `isAdmin` probe it used to be.
   */
  ops: OpsApp;
  /**
   * The test cases a project defines, the runs they produced, and the live
   * tenant emitter a running simulation reports itself on.
   */
  scenarios: ScenarioApp;
  /** The folders and suites those cases are grouped into, and their runs. */
  suites: SuiteApp;
  organizations: OrganizationApp;
  /**
   * The permission probe the flag surface authorizes its own tenant target
   * with. Narrowed to the one method it calls rather than the whole service:
   * a flag read resolves the organization behind a project id and asks once.
   */
  permissions: Pick<AuthzService, "hasPermission">;
  presence: PresenceService;
  /**
   * The project application, as `project.*` writes through it and every other surface
   * reads a project's organization off it. The WHOLE application rather than the single
   * read the flag surface declared.
   */
  projects: ProjectApp;
  /** A project's prompt library, its versions and its tag catalogue. */
  prompts: PromptApp;
  /**
   * The retention policy a shared link and a pinned trace are bounded by. A
   * pin cannot outlive the trace it points at, which is the one thing the pin
   * surface reads it for.
   */
  dataRetention: DataRetentionService;
  /**
   * The provider gateway, as the provider, cost-rule and translation surfaces
   * reach it.
   */
  modelProviders: ModelProviderApp;
  /**
   * The real-time evaluations running against a project's traffic, as the
   * wizard's reads and writes and the copy into another project reach them.
   */
  monitors: MonitorApp;
  /**
   * The content-addressed object store, as the existence probe reads it. One
   * application for the probe and the byte read, because a renderer that was
   * told a file exists must be reading the same store the bytes come from.
   */
  storedObjectApp: StoredObjectApp;
  /**
   * Which plan an organization is on. Narrowed to the one method the plan
   * surface calls, because ONE answer to "which plan" is the whole point of a
   * plan provider and a wider slice invites a second.
   */
  planProvider: Pick<PlanProvider, "getActivePlan">;
  /** The share ledger behind a link, a pin, and the anonymous trace read. */
  share: ShareService;
  /** The clusters a project's traces were grouped into. */
  topics: TopicService;
  /**
   * The trace application all five trace doors read through — the explorer, the legacy
   * grid, one trace's spans, the reviewer's correction, and the anonymous share page. One
   * instance, so the share page can never drift behind an in-app redaction.
   */
  traces: TraceApp;
  /**
   * Custom role definitions and the bindings that hand them out. One
   * application for both surfaces: who holds a role and what that role grants
   * are the same question asked from two ends.
   */
  roles: RoleApp;
  users: UserApp;
  workflows: WorkflowApp;
  /**
   * The deployment answers `publicEnv` reads directly. One field today, and it
   * is configuration rather than a service, so it rides the application slice
   * the transport already receives instead of a second channel.
   */
  config: Readonly<{ opsSidebarEmails?: readonly string[] | undefined }>;
}> &
  /**
   * The slices the four Enterprise surfaces read, taken from the ONE seam a core process
   * may see them through.
   */
  EnterpriseTrpcContext["app"];

/**
 * The request member the two SaaS-only billing surfaces read.
 */
export type ApiTrpcEnterpriseRequest = Pick<EnterpriseTrpcContext, "req">;

/**
 * The signed-in person, as the surfaces that render them read it.
 */
export type ApiTrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  /**
   * The real administrator when one is acting as this person.
   */
  impersonator?: ApiTrpcSessionUser;
}>;

export type ApiTrpcSession = Readonly<{
  user: ApiTrpcSessionUser;
  /** The browser session's own id, where the deployment tracks one. */
  sessionId?: string;
}>;

/**
 * The context the process-owned ports read, as they read it. The packaged port signatures
 * type their `ctx` against the FEATURE's own context — the narrow slice that feature
 * declared — because a port is written for a host the package cannot name.
 */
export type ApiTrpcPortsContext = Readonly<{
  actor(): Readonly<{ id: string }>;
  session?: ApiTrpcSession | null;
  app: ApiTrpcFeatureApplication;
}>;
