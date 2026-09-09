/**
 * The request context every packaged tRPC surface on this process is resolved against.
 * Every mounted feature names its own context type, and each of those names one slice of
 * the host application plus, for a few, the authenticated session.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { LangyApp } from "@langwatch/langy-server";
import type { OpsApp } from "@langwatch/ops-server";
import type { ScenarioApp } from "@langwatch/scenario-server";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AutomationApp } from "@langwatch/automation-server";
import type { CodingAgentApp } from "@langwatch/coding-agent-server";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type {
  BillingCurrencyApi,
  BillingSubscriptionApi,
  CurrencyRequest,
} from "@langwatch/enterprise-billing-server";
import type {
  ScimApi,
  SsoApi,
  GovernanceApp,
  GovernanceService,
  OrganizationSessionPolicyService,
  WebhookApp,
} from "@langwatch/enterprise-api";
import type { LicensingApi, LimitType } from "@langwatch/enterprise-licensing-contract";
import type { GatewayApp } from "@langwatch/gateway-server";
import type { GithubService } from "@langwatch/github-contract";
import type { AuthzApi, AuthzService } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApp } from "@langwatch/dataset-server";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApp } from "@langwatch/evaluator-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { OrganizationApp } from "@langwatch/organization-server";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ModelProviderApp } from "@langwatch/model-provider-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { StoredObjectApp } from "@langwatch/stored-object-server";
import type { SecretApi } from "@langwatch/secret-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { TraceApp } from "@langwatch/trace-server";
import type { ProjectApp } from "@langwatch/project-server";
import type { PromptApp } from "@langwatch/prompt-server";
import type { RoleApi } from "@langwatch/role-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApp } from "@langwatch/workflow-server";

/**
 * The application slices the mounted surfaces read off `ctx.app`.
 */
export type ApiTrpcFeatureApplication = Readonly<{
  analytics: AnalyticsApp;
  annotation: AnnotationApi;
  apiKeys: ApiKeyApi;
  /**
   * A project's triggers, their channels and the addresses that asked those channels to
   * stop. One application for both wire names, because a suppression is a fact about a
   * trigger's delivery rather than a resource of its own.
   */
  automation: AutomationApp;
  /** What the coding agents did inside a project, as the read surfaces ask it. */
  codingAgentApp: CodingAgentApp;
  /** What the caller may do at one scope, as `authz.*` reports it back to them. */
  authzApp: AuthzApi;
  broadcast: PresenceEmitterPort;
  dashboard: DashboardApi;
  /**
   * A project's datasets, the rows inside them and the batch-evaluation
   * rollups over them. One application for all three surfaces, because a
   * project's rows are one set.
   */
  dataset: DatasetApp;
  /**
   * One trace's evaluations: what has been scored, what a re-score costs, and
   * the pipeline command a workbench cell reports its own run on.
   */
  evaluations: EvaluationApi;
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
  featureFlag: FeatureFlagApi;
  /**
   * Which of the two currencies a reader's prices are quoted in. Composed
   * everywhere: the rule reads headers and names no tenant.
   */
  billingCurrency: BillingCurrencyApi;
  /**
   * The paid plan an organization is on, and the checkout that changes it.
   * Absent where this deployment composed no payment provider.
   */
  billingSubscription?: BillingSubscriptionApi | undefined;
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
  /**
   * What this instance is licensed for, and the seat ceilings that licence
   * sets. One application for `license.*` and `licenseEnforcement.*`, because
   * the licence that sets a ceiling and the ceiling a create button asks about
   * cannot be allowed to disagree.
   */
  licensing: LicensingApi;
  /**
   * Where a reached ceiling is reported. Still on the slice although no
   * transport reads it: the licence application is COMPOSED over it, so the
   * deployment that answered the check is the one that raises the alert.
   */
  usageLimits: Readonly<{
    notifyResourceLimitReached(
      input: Readonly<{
        organizationId: string;
        limitType: LimitType;
        current: number;
        max: number;
      }>,
    ): Promise<void>;
  }>;
  /** The rules an organization bounds its members' sessions by. */
  sessionPolicy: OrganizationSessionPolicyService;
  /**
   * The directory-sync application. One object for both of its doors, so the
   * settings page and the management REST family cannot drift on what minting
   * a provisioning token means.
   */
  scim: ScimApi;
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
  suites: SuiteApi;
  organizations: OrganizationApp;
  /**
   * The permission probe the flag surface authorizes its own tenant target
   * with. Narrowed to the one method it calls rather than the whole service:
   * a flag read resolves the organization behind a project id and asks once.
   */
  permissions: Pick<AuthzService, "hasPermission">;
  presence: PresenceApi;
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
  dataRetention: DataRetentionApi;
  /**
   * The provider gateway, as the provider, cost-rule and translation surfaces
   * reach it.
   */
  modelProviders: ModelProviderApp;
  /**
   * The real-time evaluations running against a project's traffic, as the
   * wizard's reads and writes and the copy into another project reach them.
   */
  monitors: MonitorApi;
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
  /**
   * A project's stored credentials, as `secrets.*` and every process
   * collaborator that decrypts a stored value read them.
   */
  secrets: SecretApi;
  /** The share ledger behind a link, a pin, and the anonymous trace read. */
  share: ShareApi;
  /** The clusters a project's traces were grouped into. */
  topics: TopicApi;
  /**
   * A project's scoped privacy rules, as the settings screen renders them and
   * as every read redacted under them resolves one.
   */
  dataPrivacy: DataPrivacyApi;
  /**
   * Single sign-on, as the back office reads and commands a connection. One
   * application for the gate and the ledger, because whether federation is
   * licensed and which connections exist are the same question.
   */
  sso: SsoApi;
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
  roles: RoleApi;
  users: UserApi;
  workflows: WorkflowApp;
  /**
   * The operator allow-list, for the ops feature's own admin gate. One field
   * today, and it is configuration rather than a service, so it rides the
   * application slice the transport already receives instead of a second
   * channel.
   */
  config: Readonly<{ opsSidebarEmails?: readonly string[] | undefined }>;
}>;

/**
 * The request member the quoted-currency surface reads. The headers a CDN
 * injected are the whole of what its answer is decided from, and they are the
 * PROCESS's to hand over — a module cannot name the transport it arrived on.
 */
export type ApiTrpcEnterpriseRequest = Readonly<{ req: CurrencyRequest | undefined }>;

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
