/**
 * The request context every packaged tRPC surface on this process is resolved
 * against.
 *
 * `createAppTrpcFeatures` constrains its context to the INTERSECTION of every
 * mounted feature's own context type, and each of those names one slice of the
 * host application plus, for a few, the authenticated session. This module is
 * that intersection written down once, so the process has a single answer to
 * "what must a request carry for the whole record to be mountable" instead of
 * discovering it one compile error at a time.
 *
 * Two things are deliberately NOT here:
 *
 *  - the process-wide capabilities the ports reach (a mailer, a model gateway,
 *    the trace pipeline). Those are composition, not request state, and they
 *    arrive as {@link ApiTrpcCollaborators}. The platform app carried them on
 *    the request context because that is where its service locator lived; a
 *    process that composes its own graph has no reason to re-resolve them per
 *    call.
 *  - anything a feature package does not read. A slice nothing names is a slice
 *    nothing can depend on, which is what keeps this list honest.
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
 *
 * `broadcast` serves two features on purpose: the export relay asks only for
 * `getTenantEmitter`, which is the narrower half of the presence emitter, so
 * one channel answers both rather than two channels answering the same
 * question differently.
 */
export type ApiTrpcFeatureApplication = Readonly<{
  analytics: AnalyticsApp;
  annotations: AnnotationApp;
  apiKeys: ApiKeyApp;
  /**
   * A project's triggers, their channels and the addresses that asked those
   * channels to stop. One application for both wire names, because a
   * suppression is a fact about a trigger's delivery rather than a resource of
   * its own.
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
   * The AI Gateway's one application, as all six core gateway surfaces reach
   * it.
   *
   * One instance for the six namespaces AND for the two public REST families
   * beside them: the browser's door and the SDK's door decide what a virtual
   * key may reach, what a budget allows and what a key has spent from the same
   * object, so they cannot enforce different rules. That was the whole reason
   * the retired application grew this application in the first place.
   */
  gateway: GatewayApp;
  /**
   * The GitHub App an organization connected, as `github.*` reads it.
   *
   * Blank where the deployment registered no App — that is the service's own
   * answer, not an absence this record models: a process with no App still
   * mounts the namespace and reports "not connected", which is what the
   * coding-agent settings page renders.
   */
  github: GithubService;
  /**
   * The Enterprise governance capability the console's ten surfaces read, and
   * the `/` landing decision reads the setup rollup from.
   *
   * Named here rather than taken from `EnterpriseTrpcContext["app"]` below
   * because the governance transports declare their own contexts: the
   * projection would satisfy the four licensing and SCIM slices and none of
   * these.
   */
  governance: GovernanceService;
  /**
   * The governance APPLICATION beside the capability: the personal virtual
   * keys a member mints and the routing policies their traffic follows.
   *
   * Distinct from `governance` because they answer different questions — one is
   * the organization's governance state, the other is the write path over it —
   * and the two packaged transports name them apart.
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
   * The Langy conversation panel's one application — the slim spine, one
   * conversation's messages, the turn-start operation both doors share, and the
   * project's egress allow-list.
   *
   * One instance for both `langy.*` and `langyEgress.*`, because who may see a
   * conversation and what the agent behind it may reach are decided by the same
   * object; two would let the panel and the settings page disagree.
   */
  langy: LangyApp;
  /**
   * The operator back office, and the operator allow-list beside it.
   *
   * The WHOLE application rather than the single `isAdmin` probe it used to be.
   * That narrow slice was enough while nothing on this process served `ops.*`;
   * now it does, and the surface reads the queues, the event log, the process
   * fleet and the replay runner through this same object. The narrow reader —
   * the SSO connection surface, which gates on the staff list rather than on
   * `ops:*` — is satisfied by it unchanged.
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
   * The project application, as `project.*` writes through it and every other
   * surface reads a project's organization off it.
   *
   * The WHOLE application rather than the single read the flag surface
   * declared. It was the narrow read while nothing on this process created,
   * renamed, re-keyed or archived a project; now `project.*` does, and two
   * project applications would let the settings form and the flag resolution
   * disagree about which organization a project belongs to. The narrow
   * declaration in the flag package stays exactly as it is — this satisfies it.
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
   * The trace application all five trace doors read through — the explorer,
   * the legacy grid, one trace's spans, the reviewer's correction, and the
   * anonymous share page. One instance, so the share page can never drift
   * behind an in-app redaction.
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
   * The slices the four Enterprise surfaces read, taken from the ONE seam a
   * core process may see them through.
   *
   * Spelled as a projection of `EnterpriseTrpcContext` rather than restated:
   * the licensing application, the usage-limit notifier and the SCIM
   * application live in Enterprise feature packages this package must not
   * depend on, and `@langwatch/enterprise-api` is the only module that may
   * name them. A restatement here would be a second description of types
   * nobody here can check against the first.
   */
  EnterpriseTrpcContext["app"];

/**
 * The request member the two SaaS-only billing surfaces read.
 *
 * `undefined` on this process and that is the whole answer rather than a gap:
 * the currency quote is guessed from CDN headers only the hosted edge injects,
 * and this process mounts no `currency` namespace at all (see the Enterprise
 * mount's docblock). It is named because the Enterprise composition constrains
 * its context to all six of its surfaces, including the two it hands back
 * empty.
 */
export type ApiTrpcEnterpriseRequest = Pick<EnterpriseTrpcContext, "req">;

/**
 * The signed-in person, as the surfaces that render them read it.
 *
 * Wider than the actor the authorization chain uses, because presence draws
 * the person's name and picture and the ops surface reads the impersonator —
 * both from the session rather than from the payload, so a client cannot claim
 * to be somebody else.
 */
export type ApiTrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  /**
   * The real administrator when one is acting as this person.
   *
   * Optional but never `null`: two of the surfaces that read it describe the
   * "nobody is impersonating" state as an ABSENT key and two describe it as
   * `null`, and only the absent spelling satisfies both. One spelling is also
   * the safer one to converge on — a `null` that slips past a truthiness check
   * reads as an impersonator object.
   */
  impersonator?: ApiTrpcSessionUser;
}>;

export type ApiTrpcSession = Readonly<{
  user: ApiTrpcSessionUser;
  /** The browser session's own id, where the deployment tracks one. */
  sessionId?: string;
}>;

/**
 * The context the process-owned ports read, as they read it.
 *
 * The packaged port signatures type their `ctx` against the FEATURE's own
 * context — the narrow slice that feature declared — because a port is written
 * for a host the package cannot name. A host implementing one reads its own
 * context back out, which is what this alias is for: one written statement of
 * what the API process's ports may rely on, rather than a cast per entry.
 */
export type ApiTrpcPortsContext = Readonly<{
  actor(): Readonly<{ id: string }>;
  session?: ApiTrpcSession | null;
  app: ApiTrpcFeatureApplication;
}>;
