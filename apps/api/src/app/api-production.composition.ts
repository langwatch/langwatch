import type { AgentService } from "@langwatch/agent-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import type { RedisConnection } from "@langwatch/redis-client";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservability,
} from "@langwatch/observability/node";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { createApiKeysRestApp } from "@langwatch/api-key-server";
import { PostgresSecretAdapter, type SecretEncryptionPort } from "@langwatch/secret-server";
import { RESERVED_PROJECT_SECRET_NAMES } from "@langwatch/secret-contract";
import { Hono } from "hono";
import { register } from "prom-client";
import {
  ApiAuditPort,
  ApiRequestPolicy,
  AuthzApiAuthorizationAdapter,
} from "../api-request.policy";
import {
  ApiFeatureDrainPort,
  ApiProcess,
  ApiProcessGraphPort,
  closeApiProcessResources,
} from "../api.process";
import { ApiHttpListener } from "../api-http.listener";
import { tryCreateHostedMcpSurface } from "../features/mcp/hosted-mcp.mount";
import {
  ApiMetricsPort,
  ApiProcessLifecycleRoutes,
  ApiReadinessPort,
} from "../api-process.lifecycle";
import {
  ApiDatabaseAbsenceReportPort,
  ApiDatabaseInfrastructure,
} from "../platform/infrastructure/api-database.infrastructure";
import {
  ApiQueueAbsenceReportPort,
  ApiQueueInfrastructure,
} from "../platform/infrastructure/api-queue.infrastructure";
import {
  ApiEventingAbsenceReportPort,
  ApiEventingInfrastructure,
} from "../platform/infrastructure/api-eventing.infrastructure";
import {
  ApiClickHouseAbsenceReportPort,
  ApiClickHouseInfrastructure,
} from "../platform/infrastructure/api-clickhouse.infrastructure";
import { ApiAgentsAbsenceReportPort, ApiAgentsComposition } from "./api-agents.composition";
import {
  composeApiAnalyticsCollaborators,
  withApiAnalyticsCollaborators,
  type ApiAnalyticsCollaborators,
} from "./api-trpc-collaborators.analytics.composition";
import {
  composeApiIdentityCollaborators,
  withApiIdentityCollaborators,
  type ApiIdentityCollaborators,
  type ApiIdentityDeploymentFacts,
  type ApiIdentityMailPort,
} from "./api-trpc-collaborators.identity.composition";
import { ApiEventingIdentityAdapter } from "./api-identity-eventing.adapter";
import {
  composeApiExecutionCollaborators,
  withApiExecutionCollaborators,
  type ApiExecutionCollaborators,
} from "./api-trpc-collaborators.execution.composition";
import {
  composeApiTraceGroupCollaborators,
  LoggedApiTraceGroupAbsence,
  withApiTraceGroupCollaborators,
  type ApiModelProviderHostPort,
  type ApiStudioHostPort,
  type ApiTraceGroupCollaborators,
  type ApiTraceReadStackPort,
  type ApiUsageStatsPort,
} from "./api-trpc-collaborators.trace-group.composition";
import type { PlanProvider } from "@langwatch/entitlement-contract";

/**
 * The retention floor a project with no policy of its own is bounded by.
 *
 * The platform application's `PLATFORM_DEFAULT_RETENTION_DAYS`. Stated rather
 * than imported, for the reason the analytics half states its own copy: the
 * retention vertical has not moved, and silently taking an adapter's shorter
 * default would shorten every project's window on a deployment that never
 * changed a setting.
 */
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;
import {
  composeApiModelProviders,
  LoggedApiModelProviderAbsence,
} from "./api-model-provider.composition";
import {
  composeApiAgentGroupCollaborators,
  LoggedApiAgentGroupAbsence,
  withApiAgentGroupCollaborators,
  type ApiAgentGroupCollaborators,
} from "./api-trpc-collaborators.agent-group.composition";
import {
  composeApiProductGroupCollaborators,
  withApiProductGroupCollaborators,
  type ApiProductGroupCollaborators,
} from "./api-trpc-collaborators.product-group.composition";
import {
  composeApiProductInfraCollaborators,
  LoggedApiProductInfraAbsence,
  withApiProductInfraCollaborators,
  type ApiProductInfraCollaborators,
} from "./api-trpc-collaborators.product-infra.composition";
import {
  composeApiOrgGroupCollaborators,
  withApiOrgGroupCollaborators,
  type ApiEnterpriseApplicationPort,
  type ApiOrgGroupCollaborators,
  type ApiOrganizationInvitePort,
  type ApiViewerProtectionsPort,
} from "./api-trpc-collaborators.org-group.composition";
import {
  composeApiGatewayGroupCollaborators,
  withApiGatewayGroupCollaborators,
  type ApiGatewayGroupCollaborators,
} from "./api-trpc-collaborators.gateway-group.composition";
import type { ApiGatewayIdempotencyPort } from "./api-gateway.composition";
import { createGatewayPlatformRestApp } from "@langwatch/gateway-server";
import { PostgresGithubAdapter } from "@langwatch/github-server";
import type { GithubService } from "@langwatch/github-contract";
import { PostgresMonitorAdapter } from "@langwatch/monitor-server";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { nanoid } from "nanoid";
import {
  composeApiProductCollaborators,
  sealApiTrpcCollaborators,
  withApiProductCollaborators,
  ApiTrpcCollaboratorGapReport,
  type ApiAnnotationTraceContentPort,
  type ApiProductCollaborators,
  type ApiSimulationEvidencePort,
  type ApiTraceProducerCommands,
} from "./api-trpc-collaborators.product.composition";
import { TraceSpanIngestPort } from "@langwatch/trace-server";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  ApiTrpcFeaturesComposition,
  LoggedApiTrpcFeaturesAbsence,
} from "./api-trpc-features.composition";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import { generateClickHouseFilterConditions } from "@langwatch/analytics-server";
import { composeApiModelProviderHost } from "./api-model-provider-host.composition";
import { composeApiStudioHost } from "./api-studio-host.composition";
import { ApiExperimentRunAbsenceReport } from "./api-experiment-run.composition";
import { composeApiTraceReadStack } from "./api-trace-read-stack.composition";
import {
  apiEntitlementAbsenceReport,
  composeApiPlanProvider,
  composeApiUsageStats,
  type LoggedApiEntitlementAbsence,
} from "./api-usage.composition";
import { ApiAuthzAbsenceReportPort, ApiAuthzComposition } from "./api-authz.composition";
import { ApiTenancyAbsenceReportPort, ApiTenancyComposition } from "./api-tenancy.composition";
import {
  ApiMetricsAbsenceReportPort,
  ApiMetricsInfrastructure,
} from "../platform/infrastructure/api-metrics.infrastructure";
import {
  ApiSecretEncryptionAbsenceReportPort,
  ApiSecretEncryptionInfrastructure,
} from "../platform/infrastructure/api-secret-encryption.infrastructure";
import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main";
import { ApiSecretRestFeature } from "../api-secret-rest.feature";
import { ApiRestSecurity, type ApiRestProjectPolicy } from "../api-rest.security";
import type { AppRestManagementAuditPort, AppRestSecurity } from "@langwatch/api/rest";
import type { AppRestFeaturePorts } from "../app-rest/app-rest.features";
import { ApiRateLimitInfrastructure } from "../platform/infrastructure/api-rate-limit.infrastructure";
import {
  ApiAuthAbsenceReportPort,
  ApiAuthComposition,
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
  AuthSessionApiAuthenticationAdapter,
} from "./api-auth.composition";
import { ApiInstanceAdminKeyAdapter } from "./api-instance-admin-key.adapter";
import { ApiRestObservabilityComposition } from "./api-rest-observability.composition";
import type { ApiSubscriptionMount } from "../api.application";
import { createSseSubscriptionApp } from "../app-trpc/app-trpc.sse";
import { ApiHandlerManagedSession } from "./api-handler-managed-session";
import { createApiProcessRestFeatures } from "../app-rest/app-rest.process-features";
import { ApiHandlerManagedCredentials } from "./api-handler-managed-credential";
import { apiClientAddress } from "./api-client-address";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";
import {
  composeApiTraceIngest,
  LoggedApiTraceIngestAbsence,
} from "./api-trace-ingest.composition";
import {
  PrismaBugReportRepository,
  SilentBugReportNotifier,
  type BugReportRestPorts,
} from "@langwatch/ops-server";
import type { UnsubscribeRestPorts } from "@langwatch/automation-server";
import {
  apiLangyRestMetrics,
  composeApiLangyRest,
  type ApiLangyRestComposition,
} from "../features/langy/langy-rest.mount";
import { composeApiGithubRest } from "../features/github/github-rest.mount";
import type { GithubRestPorts } from "@langwatch/github-server";

/**
 * The `AppRestFeaturePorts` entries the API process supplies out of its own
 * configuration and its own infrastructure, rather than receiving from a host.
 *
 * Two today: the instance administrator credential, which is a value in the
 * process's validated config, and the public REST rate limiter, which is a
 * counter over the process's own Redis. Neither needed anything from the
 * legacy application to begin with — they were only there because that is
 * where the environment and the Redis client used to live.
 */
export type ApiOwnedRestFeaturePorts = Pick<AppRestFeaturePorts, "instanceAdminKey" | "rateLimit">;

/**
 * What a host hands the production composition, and what it may leave out.
 *
 * One flat object, and every field on it is optional. A host supplies a field
 * to OVERRIDE what this process would compose for itself — a test binding a
 * double, or a deployment that already owns one instance of the service graph
 * — rather than to unlock a graph that would not exist without it. Leaving any
 * of them out is a supported shape with the consequence each one names, and
 * one of them is not a service at all: `browserSessions` is the deployment's
 * own Better Auth instance, the last collaborator on this list no package
 * implements.
 */
export type ApiProductionCompositionOptions = {
  /**
   * A host's already-composed agent service, when it has one.
   *
   * Optional since this process can build its own over its guarded client, with
   * the one gap that composition names: it holds no Workflow application, so
   * copying a workflow agent refuses rather than writing an agent pointing at
   * another project's graph. See
   * {@link ApiProductionComposition.resolveAgents} for which wins and what an
   * unresolvable agent service means for the door that serves it.
   */
  agents?: AgentService;
  /**
   * A host's already-composed secret service, when it has one.
   *
   * Optional since this process can build its own: see
   * {@link ApiProductionComposition.resolveSecrets} for which wins.
   */
  secrets?: SecretService;
  /**
   * A host's already-composed API-key service, when it has one.
   *
   * Optional since this process can build its own, but only as a PAIR with the
   * organization service: see {@link ApiProductionComposition.resolveTenancy}
   * for why supplying one without the other is refused.
   */
  apiKeys?: ApiKeyService;
  /**
   * A host's already-composed AuthZ service, when it has one.
   *
   * Optional since this process can build its own: see
   * {@link ApiProductionComposition.resolveAuthz} for which wins and what an
   * unresolvable AuthZ means for the doors that authorize through it.
   */
  authz?: AuthzService;
  /** A host's already-composed organization service; the pair to `apiKeys`. */
  organizations?: OrganizationService;
  /**
   * A host's already-composed Auth service and Better Auth transport, when it
   * has them as a pair.
   *
   * Optional since this process can build the Auth half itself: see
   * {@link ApiProductionComposition.resolveAuth} for which wins and what
   * neither means for the doors that authenticate a browser caller.
   */
  auth?: ApiAuthSessionCompositionPort;
  /**
   * The deployment's Better Auth request boundary, for a host that supplies
   * only that.
   *
   * This is the collaborator the API package cannot build — see
   * {@link ApiAuthComposition} — and the one entry on
   * `API_UNAVAILABLE_PRODUCT_ADAPTERS`. Without it, and without `auth`, this
   * process can authenticate no browser caller and mounts no product
   * transports at all. Ignored when `auth` is supplied, because that pair
   * already carries its own transport.
   */
  browserSessions?: ApiBrowserSessionTransportPort;
  audit?: ApiAuditPort;
  readiness?: ApiReadinessPort;
  /**
   * A host's already-composed metrics transport, when it has one.
   *
   * Optional since this process can build its own: see
   * {@link resolveApiMetrics} for which wins.
   */
  metrics?: ApiMetricsPort;
  featureDrain?: ApiFeatureDrainPort;
  queueStorage?: GroupQueueStoragePort;
  /**
   * The capabilities the packaged tRPC record reaches that no package owns
   * yet — the analytics filter catalogue, the LangWatchQL workbench, the trace
   * pipeline, the sign-in and sign-up ceremonies, the evaluator runtime, the
   * model gateway and the Enterprise governance surfaces.
   *
   * Optional, and its absence is the reason this process serves no packaged
   * namespaces rather than a reason it fails to boot. See
   * {@link ApiTrpcCollaborators}: with them, all twenty-two mount on the same
   * root the subscription lane resolves paths on; without them, the process
   * serves its agent and secret routers exactly as before and says so once at
   * boot.
   */
  trpcCollaborators?: AnyApiTrpcCollaborators;
  /**
   * A host's already-composed model gateway, when it has one.
   *
   * Optional since this process now composes its own — see
   * {@link ApiProductionComposition.resolveModelProviders} and
   * `api-model-provider.composition.ts` for the six ports and where each is
   * answered from. An injected service still wins, for the same reason the
   * secret and API-key services let one win: a host that already owns the
   * product graph has ONE gateway per process, and a Studio node resolved
   * through a second one could disagree with it about which credential a
   * provider row holds.
   *
   * What it no longer means is an absent execution half: the four namespaces
   * mount whenever this process has a database, an agent service and a stored
   * secret cipher, whether or not a host hands anything in.
   */
  modelProviders?: ModelProviderService;
  /**
   * The four facts a person-shaped surface needs that are the DEPLOYMENT's:
   * its public host, the sign-in provider it mounted, whether it registered
   * passkeys, and who its operators are.
   *
   * Optional, and every absence has a stated consequence rather than a
   * default — see {@link ApiIdentityDeploymentFacts}. They arrive as options
   * rather than as configuration leaves because they are the same class of
   * thing `browserSessions` is: the deployment's, not this package's.
   */
  identity?: ApiIdentityDeploymentFacts;
  /**
   * The messages the identity surfaces send, where the deployment composed a
   * mail gateway.
   *
   * A port rather than the gateway, and for a structural reason: rendering a
   * LangWatch message is react-email, and this process must not pull a React
   * renderer onto its import graph. See {@link ApiIdentityMailPort}.
   */
  mail?: ApiIdentityMailPort;
  /**
   * The reviewer's trace content, for the annotation queue.
   *
   * The one thing the product half cannot build for itself: resolving a
   * trace's full content with the caller's own redactions applied reaches a
   * trace application this process does not compose. Absent means
   * `annotation.getQueueItems` refuses by name rather than showing a reviewer
   * an empty queue — see {@link ApiAnnotationTraceContentPort}.
   */
  traceContent?: ApiAnnotationTraceContentPort;
  /**
   * Whether a project has run any simulation, for the setup checklist.
   *
   * Absent reports that one step as not started, which is what the application
   * answered whenever the read failed and is the safe direction: a checklist
   * that wrongly says "done" stops somebody finishing their setup.
   */
  simulations?: ApiSimulationEvidencePort;
  /**
   * The ClickHouse trace READ stack, for the five trace surfaces.
   *
   * The largest thing the observability half cannot build: the ten readers the
   * trace application is composed from, plus the redaction and display passes
   * every read is carried through. Absent, every trace read refuses by name and
   * both live-update subscriptions keep streaming — see
   * {@link ApiTraceReadStackPort}.
   */
  traceReads?: ApiTraceReadStackPort;
  /**
   * The provider capabilities that reach OUTSIDE this process: the vendor
   * credential probes, the Codex device flow and the cost-rule span preview.
   * Absent, each refuses; the regex safety gate falls back to a conservative
   * answer because the cost-rule schemas are built from it.
   */
  modelProviderHost?: ApiModelProviderHostPort;
  /**
   * The optimization studio's outbound event dispatch, and the agent test's own
   * trace write. Absent, both refuse.
   */
  studio?: ApiStudioHostPort;
  /**
   * The usage reading and the approaching-limit mail, over the deployment's
   * billing store. Absent, both refuse rather than reporting zero of an
   * allowance, which would be a wrong answer rather than a smaller one.
   */
  usage?: ApiUsageStatsPort;
  /** Which plan an organization is on. Absent, the plan read refuses. */
  plans?: PlanProvider;
  /**
   * The invitation service `organization.*` creates, lists, resends, revokes
   * and applies invitations through. Absent, all twelve refuse by name — an
   * empty invite list would tell an administrator nobody had been invited.
   */
  organizationInvites?: ApiOrganizationInvitePort;
  /**
   * The caller's read-time redactions for one project, as
   * `codingAgents.sessionsList` and `project.getFieldRedactionStatus` ask
   * them. The same resolution `traceReads` answers; absent, both refuse rather
   * than guessing what a reader may see.
   */
  viewerProtections?: ApiViewerProtectionsPort;
  /**
   * The Enterprise application the licence, licence-enforcement, SCIM-token,
   * single sign-on and fifteen governance surfaces read. Absent, all nineteen
   * MOUNT and refuse by name: a client asking what its licence allows must be
   * told this deployment cannot answer, not find the namespace missing.
   */
  enterprise?: ApiEnterpriseApplicationPort;
  /**
   * The receipt ledger the three keyed gateway REST creates dispatch through.
   *
   * Absent, each of them refuses by name rather than executing unguarded: a
   * create sent twice with one `Idempotency-Key` would mint two virtual keys,
   * which is the failure the key exists to prevent.
   */
  gatewayIdempotency?: ApiGatewayIdempotencyPort;
};

/** The credential pair every product transport on this process is built from. */
type ApiResolvedTenancy = Readonly<{
  apiKeys: ApiKeyService;
  organizations: OrganizationService;
}>;

/** The concrete composition port for the migrated API transports. */
export class ApiProductionComposition extends ApiRuntimeCompositionPort {
  static create(options: ApiProductionCompositionOptions): ApiProductionComposition {
    // Checked here rather than at compose, because it is a fact about the
    // options and not about the deployment: it can be answered before a socket
    // is opened, and answering it later would open resources for a graph that
    // was never going to be composed.
    if (Boolean(options.apiKeys) !== Boolean(options.organizations)) {
      throw new Error(
        "API composition received one of the API-key and organization services without the other: they are one graph and must be supplied together, or neither.",
      );
    }
    return new ApiProductionComposition(options);
  }

  private composedFeaturePorts: ApiOwnedRestFeaturePorts | undefined;
  private composedDatabase: ApiDatabaseInfrastructure | undefined;
  private composedEventing: ApiEventingInfrastructure | undefined;
  private composedAuthz: ApiAuthzComposition | undefined;
  private composedTenancy: ApiTenancyComposition | undefined;
  private composedAgents: ApiAgentsComposition | undefined;
  private composedAuth: ApiAuthComposition | undefined;
  private composedClickHouse: ApiClickHouseInfrastructure | undefined;
  private composedAnalytics: ApiAnalyticsCollaborators | undefined;
  private composedIdentity: ApiIdentityCollaborators | undefined;
  private composedExecution: ApiExecutionCollaborators | undefined;
  private composedProduct: ApiProductCollaborators | undefined;
  private composedTraceGroup: ApiTraceGroupCollaborators | undefined;
  private composedProductGroup: ApiProductGroupCollaborators | undefined;

  private composedProductInfra: ApiProductInfraCollaborators | undefined;
  private composedAgentGroup: ApiAgentGroupCollaborators | undefined;
  private composedOrgGroup: ApiOrgGroupCollaborators | undefined;
  private composedGatewayGroup: ApiGatewayGroupCollaborators | undefined;
  private composedGithub: GithubService | undefined;
  private composedMonitors: MonitorService | undefined;
  private composedModelProviders: ModelProviderService | undefined;
  private composedPlanProvider: PlanProvider | undefined;
  private composedEntitlementAbsence: LoggedApiEntitlementAbsence | undefined;
  /**
   * The one shared counter. Built at construction rather than inside
   * {@link composeFeaturePorts} because two callers meter through it — the
   * public REST surface and the identity half's throttles — and two limiter
   * instances would give a caller two budgets for one rule.
   */
  private readonly rateLimiter = ApiRateLimitInfrastructure.create({
    connection: () => this.composedQueueRedis,
  });

  private composedQueueRedis: RedisConnection | undefined;
  /**
   * The shared bearer the Langy agent presents on its callbacks, held from
   * `compose` because the doors that read it are built by {@link composeDoors},
   * which is handed a request policy rather than a configuration.
   */
  private composedLangyInternalSecret: string | undefined;
  private secrets: SecretService | undefined;
  private requestPolicy: ApiRequestPolicy | undefined;

  private constructor(private readonly options: ApiProductionCompositionOptions) {
    super();
  }

  /**
   * Composes the process, in the one order its parts allow.
   *
   * Infrastructure first, because every product service below is built from
   * it; then AuthZ, because both doors authorize through it and neither can be
   * built before it exists; then the transports.
   *
   * With no AuthZ, no organization and API-key pair, or no way to authenticate
   * a browser caller, the process serves its lifecycle surface and no product
   * transports at all. That is the same rule the secret family follows one
   * level down — a door that cannot answer is absent rather than mounted — and
   * it is the only safe reading at this level: every product route on this
   * process is authorized, every one of them resolves a credential, and the
   * ones a person reaches resolve a session, so a route graph mounted over any
   * of those gaps would be a route graph that cannot say no. The session gap is
   * the sharpest of the three, because its degradation is silent: a policy
   * built over a transport that verifies nothing does not fail, it answers
   * "signed out" to everybody.
   */
  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const queueInfrastructure = this.composeQueue(options);
    this.composedDatabase = composeApiDatabase(options);
    this.composedEventing = this.composeEventing(options, queueInfrastructure);
    const authz = this.resolveAuthz(options, queueInfrastructure);
    const readiness = this.options.readiness ?? queueInfrastructure?.readiness;
    const metrics = resolveApiMetrics({ options, injected: this.options.metrics });
    const encryption = composeApiSecretEncryption(options)?.encryption;
    const tenancy = authz ? this.resolveTenancy(options, encryption) : undefined;
    const auth = tenancy ? this.resolveAuth(options, tenancy, queueInfrastructure) : undefined;

    if (!authz || !tenancy || !auth) {
      return Promise.resolve(
        composeApiLifecycleProcess({
          options,
          metrics,
          readiness,
          featureDrain: this.options.featureDrain,
        }),
      );
    }

    this.secrets = this.resolveSecrets(encryption);
    this.composedFeaturePorts = this.composeFeaturePorts(options, queueInfrastructure);
    this.requestPolicy = ApiRequestPolicy.create({
      authentication: AuthSessionApiAuthenticationAdapter.create(auth.compose()),
      authorization: AuthzApiAuthorizationAdapter.create(authz),
      audit: this.options.audit,
    });
    const agents = this.resolveAgents(options);
    // The charted reads, the workbench and the dashboards, composed over this
    // process's OWN ClickHouse and the second, restricted identity a member's
    // submitted SQL runs as. Both are this composition's to open, so the record
    // below can be satisfied without a host handing them in.
    this.composedAnalytics = this.composeAnalytics(options, authz);
    // The person half of the same record: the two signed-out doors, the
    // signed-in person's account and credentials, their organization's
    // membership and groups, join requests, sign-up and presence. Composed
    // over the SAME user directory the browser-session boundary resolves
    // through and the SAME organization service the REST doors serve from —
    // a second of either would be a second answer to who somebody is.
    this.composedIdentity = this.composeIdentity(options, auth, tenancy, queueInfrastructure);
    // The execution half: the studio's own lifecycle, the optimization panel,
    // the experiment wizard and workbench, and the evaluator surfaces. One
    // workflow service serves all four plus the evaluator service built over
    // it, and the evaluation re-score reports through a PRODUCER-only
    // registration of the same pipeline the worker drains.
    this.composedExecution = this.composeExecution(
      options,
      agents,
      encryption,
      tenancy,
      queueInfrastructure,
    );
    // The product half: a reviewer's annotations, the support inbox, the
    // project's privacy rules and its setup checklist. It composes FIRST
    // because it is the one half that cannot be missing on a process holding a
    // database, which is what makes it the seed the other three fold onto.
    this.composedProduct = this.composeProduct(options, authz);
    // The observability half: the trace itself and the fifteen surfaces it is
    // shared, labelled, priced and bounded through. It composes LAST because it
    // reads what the other halves opened — this process's ClickHouse, its
    // provider gateway and the broadcast fabric presence already publishes on —
    // and it is the one half that cannot be missing on a process holding a
    // database, which is why its fold refuses rather than passing through.
    this.composedTraceGroup = this.composeTraceGroup(
      options,
      authz,
      queueInfrastructure,
      encryption,
    );
    // The product-group half: the surfaces a member reaches to RUN the product
    // rather than to look at what it recorded. It folds on rather than seeding,
    // because it needs the tenancy graph that the seed above does not.
    this.composedProductGroup = this.composeProductGroup(options, authz);
    // The agent half: the test cases and conversations an agent is written,
    // watched and driven through. It composes LAST because it reads what every
    // other half opened — this process's ClickHouse, the queue's Redis, the
    // broadcast fabric presence publishes on, and the agent, user and project
    // directories the tenancy and identity halves built.
    this.composedAgentGroup = this.composeAgentGroup(options, authz, queueInfrastructure, encryption);
    // The org-group half: the nine surfaces a TENANT is administered through —
    // its members and their bindings, its projects' own lifecycle, the coding
    // agents inside them, the automations they fire, and the four Enterprise
    // namespaces. It folds on rather than seeding, because every one of them
    // resolves an organization or a project through the tenancy graph.
    this.composedOrgGroup = this.composeOrgGroup(options, authz, queueInfrastructure, encryption);
    // The product-infrastructure half: a project's own object store, the
    // retention window it is swept on, and the monitors running beside it. It
    // composes after the execution and product-group halves because it takes
    // their monitor service, evaluator service and evaluator replication —
    // one graph per answer, rather than a second one that could disagree.
    this.composedProductInfra = this.composeProductInfra(options, authz);
    // The gateway-group half: the twenty-one surfaces the AI Gateway and the
    // governance console that steers it are administered through, plus the
    // GitHub App beside them. It composes LAST because it reads what the
    // execution and trace halves opened — this process's evaluator service,
    // its monitor directory and its ClickHouse — and because the gateway
    // application it builds is also what the public REST door is given.
    this.composedGatewayGroup = this.composeGatewayGroup(options, authz, queueInfrastructure);
    const features = ApiTrpcFeaturesComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The SAME AuthZ service the REST doors authorize through: a permission
      // probe inside a resolver must answer what the declared check on the
      // same procedure would have.
      authz,
      audit: this.options.audit,
      // Six folds and one seal. Each fold fills the entries its half owns and
      // passes the rest through, which is what lets them compose in any order;
      // the seal is what refuses a set any of them left incomplete, naming the
      // entries rather than mounting every namespace over the gaps.
      collaborators: sealApiTrpcCollaborators(
        withApiGatewayGroupCollaborators(
        withApiProductInfraCollaborators(
        withApiOrgGroupCollaborators(
        withApiAgentGroupCollaborators(
          withApiTraceGroupCollaborators(
          withApiProductGroupCollaborators(
            withApiExecutionCollaborators(
              withApiIdentityCollaborators(
                withApiAnalyticsCollaborators(
                  withApiProductCollaborators(
                    this.options.trpcCollaborators,
                    this.composedProduct,
                  ),
                  this.composedAnalytics,
                ),
                this.composedIdentity,
              ),
              this.composedExecution,
            ),
            this.composedProductGroup,
          ),
            this.composedTraceGroup,
          ),
          this.composedAgentGroup,
        ),
          this.composedOrgGroup,
        ),
          this.composedProductInfra,
        ),
          this.composedGatewayGroup,
        ),
        LoggedApiCollaboratorGap.create(createLogger(options.config.serviceName)),
      ),
      report: LoggedApiTrpcFeaturesAbsence.create(createLogger(options.config.serviceName)),
    });
    // The hosted Model Context Protocol endpoint, served off the Node server
    // ahead of the Hono application because its Streamable HTTP and
    // Server-Sent Events transports hold the raw response for a session's
    // life. Absent when this process has no cipher or no database: the
    // endpoint would then have no way to store the API key a session was
    // minted from, or to tell whose key a bearer token is.
    const hostedMcp = tryCreateHostedMcpSurface({
      prisma: this.composedDatabase?.connection.client,
      encryption,
      redis: queueInfrastructure?.redis ?? null,
      baseHost:
        options.config.infrastructure.execution.publicBaseUrl ?? "https://app.langwatch.ai",
    });
    const process = ApiProcess.create({
      agents,
      ...(features ? { features } : {}),
      secrets: this.secrets,
      requestPolicy: this.requestPolicy,
      ...this.composeDoors(
        authz,
        tenancy,
        options.config.serviceName,
        options.config.infrastructure.execution.publicBaseUrl,
      ),
      observability: options.observability,
      graph: options.graph,
      featureDrain: this.options.featureDrain,
      readiness,
      metrics,
      listener: {
        host: options.config.host,
        port: options.config.port,
        drainGraceMs: options.config.httpDrainGraceMs,
        ...(hostedMcp ? { rawSurface: hostedMcp } : {}),
      },
    });

    return Promise.resolve(ApiProductionProcess.create(process));
  }

  /**
   * The request policy this process enforces with, once it has been composed.
   *
   * `undefined` before `compose`, and after a `compose` that resolved no AuthZ
   * — a policy whose authorization port is missing is not a weaker policy, it
   * is one that cannot refuse, so there is no object to hand back.
   */
  policy(): ApiRequestPolicy | undefined {
    return this.requestPolicy;
  }

  /**
   * The two AuthZ contract services this process serves, once composed.
   *
   * Exposed as a pair because they are one graph: the grants service writes
   * through the ledger whose commands the permission service's reads converge
   * on, and a caller holding one from this process and the other from
   * somewhere else would have two epochs for one organization.
   */
  authz(): { permissions: AuthzService; grants: AuthzGrantsService } | undefined {
    if (this.composedAuthz) {
      return { permissions: this.composedAuthz.permissions, grants: this.composedAuthz.grants };
    }
    return undefined;
  }

  /**
   * The organization, project and API-key services this process composed for
   * itself, once it has.
   *
   * `undefined` when a host supplied the pair instead, and `undefined` before
   * `compose`. Exposed as one object because they are one graph: the API-key
   * service reads the project service, which resolves through the organization
   * service, and three separately-held services could be three graphs.
   */
  tenancy(): ApiTenancyComposition | undefined {
    return this.composedTenancy;
  }

  /**
   * The feature ports this process owns, once it has been composed.
   *
   * `undefined` before `compose`, and deliberately so: the rate limiter counts
   * in the SAME Redis the queue infrastructure composed, and that connection
   * does not exist until the process does. Reading them from the composition
   * rather than binding them again is what keeps one deployment on one
   * counter and one credential.
   *
   * They are exposed rather than mounted because the two families that read
   * them still need services this package cannot construct — the organization
   * provisioning port behind `/api/organizations`, the stored-object
   * application behind `/api/files`. Neither is on
   * `API_UNAVAILABLE_PRODUCT_ADAPTERS`, which names the adapters a HOST must
   * supply; these are ports no package implements yet at all. The host that
   * mounts those families spreads these in instead of binding its own.
   */
  restFeaturePorts(): ApiOwnedRestFeaturePorts | undefined {
    return this.composedFeaturePorts;
  }

  /**
   * The process's one guarded Prisma connection, once it has been composed.
   *
   * `undefined` before `compose`, and `undefined` after it when the deployment
   * configured no `DATABASE_URL` — the same degradation Redis has. Nothing
   * below the composition root constructs a client, so this accessor is the
   * only place a typed `PrismaClient` enters the process.
   *
   * It is exposed as well as consumed. This process now builds the secret,
   * AuthZ, organization, project, API-key and agent services over it, and a
   * host that mounts families this package does not — the organization
   * provisioning door, the stored-object application — composes their packaged
   * adapters over the SAME client rather than opening a second pool with a
   * second guard.
   */
  database(): PrismaConnection | undefined {
    return this.composedDatabase?.connection;
  }

  /**
   * The secret service this process serves, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins. A host that already owns the product graph
   *     has one composed service per process, and a test that binds a double
   *     is asking for that double rather than for Postgres.
   *  2. Otherwise the process composes its own, over the guarded client
   *     {@link composeApiDatabase} opened and the cipher its configured key
   *     built. This is the first product service the API package builds for
   *     itself rather than receiving. The cipher is composed ONCE by `compose`
   *     and handed here, because the organization service's settings port runs
   *     under the same one — two ciphers over one key is a way for two
   *     descriptions of one at-rest format to drift.
   *  3. With neither — no host service, and no database or no key — there is
   *     no secret service, and the transports that would call one are not
   *     mounted. A door that answered every call with a 500 would be worse
   *     than a door that is not there.
   *
   * The reserved names come from the contract rather than from this root, so
   * a product-owned secret is hidden by this process on the same terms the
   * platform app hides it.
   */
  private resolveSecrets(encryption: SecretEncryptionPort | undefined): SecretService | undefined {
    if (this.options.secrets) return this.options.secrets;

    const database = this.composedDatabase;
    if (!database || !encryption) return undefined;

    return PostgresSecretAdapter.create({
      database: database.connection.client,
      encryption,
      reservedNames: RESERVED_PROJECT_SECRET_NAMES,
    }).build();
  }

  /**
   * The agent service this process serves, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins. A host that already owns the product graph
   *     has one composed service per process, and a test that binds a double
   *     is asking for that double rather than for Postgres.
   *  2. Otherwise the process composes its own, over the guarded client
   *     {@link composeApiDatabase} opened. The two ports that used to make
   *     this impossible — the linked-workflow reads and the agent audit
   *     history — are packaged adapters now, and both are Postgres
   *     ({@link ApiAgentsComposition}).
   *  3. With neither — no host service, and no database — there is no agent
   *     service, and the tRPC router that would call one is not mounted. The
   *     same rule the secret door follows: absent beats a door that answers
   *     every call with a 500.
   *
   * One capability the composed service does not have is announced rather than
   * discovered: this process holds no Workflow application, so copying a
   * workflow agent refuses by name instead of writing an agent that points at
   * the source project's graph.
   */
  private resolveAgents(options: ApiRuntimeCompositionOptions): AgentService | undefined {
    if (this.options.agents) return this.options.agents;

    const logger = createLogger(options.config.serviceName);
    this.composedAgents = ApiAgentsComposition.tryCompose({
      database: this.composedDatabase?.connection,
      processName: options.config.serviceName,
      report: LoggedApiAgentsAbsence.create(logger),
    });
    return this.composedAgents?.agents;
  }

  /**
   * The two doors this process opens on one credential resolution: the public
   * REST families, and the subscription lane beside them.
   *
   * Each REST family is the packaged builder over the one
   * {@link ApiRestSecurity}. Secret rides the additive public-REST builder,
   * so it takes the four-callable projection; API keys is a packaged
   * framework family, so it takes the `AppRestSecurity` directly.
   *
   * The secret family is mounted only when a service was resolved, for the
   * reason {@link ApiProductionComposition.resolveSecrets} gives.
   */
  private composeDoors(
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
    serviceName: string,
    publicBaseUrl: string | undefined,
  ): { rest: Hono; subscriptions: ApiSubscriptionMount } {
    const secrets = this.secrets;
    const gatewayApp = this.composedGatewayGroup?.gatewayApp;
    // One credential resolution for both doors: the framework-shaped
    // `AppRestSecurity` every packaged REST family is built from, and the
    // four-callable projection the additive public-REST builder takes. Both
    // wrap the same `ApiRestSecurity`, so they cannot enforce differently.
    const credentials = {
      apiKeys: tenancy.apiKeys,
      authz,
      organizations: tenancy.organizations,
      ...(this.options.audit ? { audit: this.options.audit } : {}),
    };
    const restSecurity: AppRestSecurity = ApiRestSecurity.create({
      ...credentials,
      observability: ApiRestObservabilityComposition.create(),
    });
    const projectRestPolicy: ApiRestProjectPolicy = ApiRestSecurity.projectPolicy(credentials);
    // The process-owned families FIRST, and specifically before anything that
    // could claim a parameterised segment at the root of a namespace one of
    // them owns a literal path in — the gateway spec document is the standing
    // example. Their own relative order is the array's; see
    // `createApiProcessRestFeatures`.
    const rest = new Hono();
    // The reviewer's comments are served only where this process composed the
    // annotation half; without it the family is left off rather than mounted
    // over a stub that answers 500 to every reader.
    const annotations = this.composedProduct?.annotations;
    const handlerManagedCredentials = ApiHandlerManagedCredentials.create({
      apiKeys: tenancy.apiKeys,
      authz,
    });
    // The OTLP receiver, over this process's own producer registration and its
    // own Redis. Absent where there is no command queue: a receiver with
    // nowhere to send a span would answer 200 to data it then drops.
    const otlpIngest = composeApiTraceIngest({
      eventing: this.composedEventing?.eventSourcing,
      redis: this.composedQueueRedis,
      credentials: handlerManagedCredentials,
      processName: serviceName,
      report: LoggedApiTraceIngestAbsence.create(createLogger(serviceName)),
    });
    // The gateway's public family, over the SAME application the six gateway
    // tRPC namespaces read, so the SDK's door and the browser's door cannot
    // enforce different rules. Absent where this process composed no gateway
    // group: the family is left off rather than mounted over an application
    // that is not there, which is the rule the secret family follows too.
    const gatewayRest = gatewayApp
      ? // The family declares its own project-scoped `Variables`, and a Hono
        // env parameter is contravariant in its handlers, so the narrower app
        // is not assignable to the bare `Hono` this router mounts. The
        // variables are the SECURITY chain's, set before any handler here
        // runs; nothing on this side reads them.
        (createGatewayPlatformRestApp({
          security: restSecurity,
          gateway: () => gatewayApp,
        }).hono as unknown as Hono)
      : undefined;
    const bugReports = this.composeBugReports(tenancy);
    const unsubscribe = this.composeUnsubscribe();
    const langyRest = this.composeLangyRest();
    const githubRest = this.composeGithubRest(authz);
    // The charted reads and the prompt library, over the SAME applications the
    // browser's `analytics.getTimeseries` and `prompts.*` procedures resolve
    // on. Taken from the halves rather than built a second time: two analytics
    // applications would let the public door and the dashboard disagree about
    // what a metric means, and two prompt services about what a project holds.
    const analytics = this.composedAnalytics?.analytics;
    const prompts = this.composedProductGroup?.promptApp.promptService;
    // The governed-SQL family. Every collaborator is the analytics half's own,
    // so the API key's door and the workbench's door run one validator against
    // one catalogue; the saved charts sit on the same Dashboard application
    // the browser's dashboards do.
    const analyticsHalf = this.composedAnalytics;
    const projects = this.composedTenancy?.projects;
    const langWatchQL =
      analyticsHalf && projects
        ? {
            collaborators: {
              featureFlags: () => analyticsHalf.featureFlags,
              projects: () => projects,
              langWatchQL: () => analyticsHalf.langWatchQL,
              protectionsFor: (input: { projectId: string }) =>
                analyticsHalf.apiKeyProtections(input),
            },
            dashboard: () => analyticsHalf.dashboard,
          }
        : undefined;
    // The management family's five collaborators, or none. The organization
    // object is the identity half's own merged one — the canonical settings
    // reads plus the membership operations the contract does not declare — so
    // the management door and the members screen answer from one service. The
    // share ledger and the plan provider are TAKEN from the halves that
    // composed them for the same reason.
    const organizationRest = this.composedIdentity?.organizationRest;
    const shares = this.composedTraceGroup?.share;
    const plans = this.composedPlanProvider;
    // The bulk run export. Composed only where this process holds BOTH a
    // browser-session transport and the simulation store: the session is what
    // makes a download attributable to a person, and the store is what it
    // sweeps. Without either the family is left off.
    const authSession = this.composedAuth?.compose();
    const simulations = this.composedAgentGroup?.simulations;
    const exportBroadcast = this.composedIdentity?.broadcast;
    const scenarioRunExport =
      authSession && simulations && exportBroadcast
        ? {
            simulations: () => simulations,
            broadcast: () => exportBroadcast,
            session: ApiHandlerManagedSession.create({
              auth: authSession.auth,
              sessions: authSession.sessions,
              authz,
            }),
            recordExportRequested: async (entry: {
              userId: string;
              projectId: string;
              action: "scenarioRuns.export";
              targetKind: "project";
              targetId: string;
              args: Record<string, unknown>;
            }) => {
              await this.options.audit?.record({
                actorId: entry.userId,
                path: entry.action,
                input: { projectId: entry.projectId, ...entry.args },
                error: null,
              });
            },
          }
        : undefined;
    const organizationManagement =
      organizationRest && shares && plans && projects
        ? {
            organizations: () => organizationRest,
            permissions: () => authz,
            plans: () => plans,
            shares: () => shares,
            projects: () => projects,
            audit: this.composeManagementAudit(),
          }
        : undefined;
    for (const processRestApp of createApiProcessRestFeatures({
      security: restSecurity,
      services: {
        ...(annotations ? { annotations: () => annotations } : {}),
        ...(analytics ? { analytics: () => analytics } : {}),
        ...(langWatchQL ? { langWatchQL } : {}),
        ...(prompts ? { prompts: () => prompts } : {}),
        ...(organizationManagement ? { organizationManagement } : {}),
        ...(scenarioRunExport ? { scenarioRunExport } : {}),
        organizations: () => tenancy.organizations,
      },
      ports: {
        handlerManagedCredential: (input) => handlerManagedCredentials.authenticate(input),
        // The SAME counter the packaged REST families and the identity
        // throttles meter through, so a caller has one budget per rule.
        rateLimit: (request) => this.rateLimiter.consume(request),
        ...(otlpIngest ? { otlpIngest } : {}),
        ...(bugReports ? { bugReports } : {}),
        ...(unsubscribe ? { unsubscribe } : {}),
        ...(langyRest ? { langy: langyRest } : {}),
        ...(githubRest ? { github: githubRest } : {}),
        ...(publicBaseUrl ? { publicBaseUrl } : {}),
      },
    })) {
      rest.route("/", processRestApp);
    }
    return {
      rest: rest
        .route(
          "/",
          secrets
            ? ApiSecretRestFeature.create({ secrets, security: projectRestPolicy })
            : new Hono(),
        )
        .route(
          "/",
          createApiKeysRestApp({
            security: restSecurity,
            apiKeys: () => tenancy.apiKeys,
            permissions: () => authz,
            audit: this.composeManagementAudit(),
          }).hono,
        )
        // The gateway's public family, mounted AFTER the process-owned
        // families because one of those owns a literal path inside
        // `/api/gateway/v1` — the spec document — and these routes claim
        // parameterised segments at the root of that namespace.
        .route("/", gatewayRest ?? new Hono()),
      // The subscription lane declares its access policy on the same security
      // every REST family does, so the one streaming route on this process is
      // a registry entry rather than an unaccounted-for endpoint. It is a
      // function because only the application holds the caller a path is
      // resolved on; see `ApiSubscriptionMount`.
      subscriptions: (ports) => createSseSubscriptionApp({ security: restSecurity, ports }).hono,
    };
  }

  /**
   * The AuthZ service this process authorizes with, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins. A host that already owns the product graph
   *     has one AuthZ graph per process, and a second one here would give the
   *     same organization two permission caches and two epochs.
   *  2. Otherwise the process composes its own, over the guarded client
   *     {@link composeApiDatabase} opened and the producer-only Eventing
   *     runtime this process built on its own Group Queue. The two ports that
   *     used to make this impossible — the grant command dispatcher and the
   *     revocation telemetry — are what {@link ApiAuthzComposition} builds.
   *  3. With neither there is no AuthZ service, and no product transport is
   *     mounted. Every route on this process is authorized, so mounting them
   *     over a missing AuthZ would mount routes that cannot refuse.
   */
  private resolveAuthz(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): AuthzService | undefined {
    if (this.options.authz) return this.options.authz;

    const logger = createLogger(options.config.serviceName);
    this.composedAuthz = ApiAuthzComposition.tryCompose({
      database: this.composedDatabase?.connection,
      eventing: this.composedEventing,
      epoch: queueInfrastructure?.redis ?? null,
      config: options.config.authz,
      // The registry this process renders through `/metrics`, so the AuthZ
      // series it records are the ones a scrape returns rather than samples
      // written into a registry nothing reads.
      registry: register,
      report: LoggedApiAuthzAbsence.create(logger),
    });
    return this.composedAuthz?.permissions;
  }

  /**
   * The organization and API-key services this process serves, and where they
   * came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. A host's PAIR wins. A host that already owns the product graph has one
   *     of each per process.
   *  2. Otherwise the process composes its own, together with the project
   *     service they both reach through ({@link ApiTenancyComposition}).
   *  3. With neither there is no pair, and no product transport is mounted.
   *     Every route on this process resolves a credential and authorizes it.
   *
   * A host supplying exactly ONE of them is refused by `create`, before any
   * resource is opened. The API-key service reads the project service, which
   * resolves through the organization service, so filling the gap by composing
   * the other half would hand this process an API-key service whose
   * organizations are not the organizations its own routes resolve.
   *
   * A host that injected an AuthZ service and NEITHER of these falls to (3),
   * and that is not an oversight. Both services are built from the two AuthZ
   * services as a pair, and a host hands over only the permission half — there
   * is no grants service to write their bindings through, so composing them
   * over it would produce services that can read an organization's access and
   * not change it.
   */
  private resolveTenancy(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
  ): ApiResolvedTenancy | undefined {
    const { apiKeys, organizations } = this.options;
    // `create` has already refused a half-supplied pair, so one present means
    // both are.
    if (apiKeys && organizations) return { apiKeys, organizations };

    const logger = createLogger(options.config.serviceName);
    this.composedTenancy = ApiTenancyComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The pair this process composed, never a host's single service: an
      // injected AuthZ is already reflected in `authz`, and reading it back
      // here would be reading a service whose grants half we do not hold.
      authz: this.composedAuthz
        ? { permissions: this.composedAuthz.permissions, grants: this.composedAuthz.grants }
        : undefined,
      encryption,
      pepper: options.config.apiKeyPepper,
      report: LoggedApiTenancyAbsence.create(logger),
    });
    if (!this.composedTenancy) return undefined;

    return {
      apiKeys: this.composedTenancy.apiKeys,
      organizations: this.composedTenancy.organizations,
    };
  }

  /**
   * The Auth graph this process authenticates browser callers with, and where
   * it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected composition wins. A host that already owns the product
   *     graph has one Auth service per process, and a test binding a double is
   *     asking for that double rather than for Postgres.
   *  2. Otherwise the process composes the Auth service itself, over the
   *     guarded client {@link composeApiDatabase} opened, the organization
   *     service this process already serves from, and its own Redis — pairing
   *     it with the Better Auth transport the deployment supplied
   *     ({@link ApiAuthComposition}). The port that used to make this
   *     impossible, `IdentityEmailService`, is a packaged adapter now and is
   *     Postgres end to end.
   *  3. With neither — no host composition, and no supplied transport — there
   *     is no Auth graph, and the process mounts no transports at all. Every
   *     product route a person reaches resolves their session, and a process
   *     that cannot verify one has nothing to serve them.
   *
   * The transport is deliberately still received. It is one configured Better
   * Auth server instance whose options decide whether a cookie verifies at
   * all, and a second instance composed here from a different option set would
   * answer `null` for every caller rather than fail — see
   * {@link ApiAuthComposition} for the full statement.
   */
  private resolveAuth(
    options: ApiRuntimeCompositionOptions,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiAuthSessionCompositionPort | undefined {
    if (this.options.auth) return this.options.auth;

    const logger = createLogger(options.config.serviceName);
    this.composedAuth = ApiAuthComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The organization service this process actually serves from, injected
      // or composed. A second one here would resolve a person's workspaces
      // through a graph none of this process's other doors read.
      organizations: tenancy.organizations,
      browserSessions: this.options.browserSessions,
      // The deployment's own browser-session identity, used only when no host
      // supplied a transport. Absent means this process composes no Better
      // Auth instance and mounts no transports that authenticate a browser
      // caller — never one built over a guessed secret, which would answer
      // "signed out" to everybody rather than fail.
      browserSession: options.config.browserSession,
      authProvider: this.options.identity?.authProvider,
      isSaas: this.options.identity?.isSaas,
      // The grant ledger a domain auto-join writes its membership through.
      // The pair this process composed, for the reason `resolveTenancy` gives.
      authzGrants: this.composedAuthz?.grants,
      // The SAME Redis Better Auth's own session cache lives in, so revoking a
      // session through this process clears the entry the other tier reads.
      redis: queueInfrastructure?.redis ?? null,
      processName: options.config.serviceName,
      report: LoggedApiAuthAbsence.create(logger),
    });
    return this.composedAuth;
  }

  /**
   * Composes the process's producer-only Eventing runtime over its own queue.
   *
   * Separate from the queue itself because the two absences are different
   * facts: a deployment with no Redis has no queue AND no dispatch, and a
   * reader of the boot log should see the consequence named rather than have
   * to derive it.
   */
  private composeEventing(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiEventingInfrastructure | undefined {
    const logger = createLogger(options.config.serviceName);
    return ApiEventingInfrastructure.tryCreate({
      resources: options.resources,
      queue: queueInfrastructure,
      processName: options.config.serviceName,
      report: LoggedApiEventingAbsence.create(logger),
    });
  }

  /**
   * The public issue-report intake's collaborators, or none.
   *
   * `undefined` without a database, and the family is then left off rather
   * than mounted: a reporter who is already struggling must not be told their
   * report was filed by a door that had nowhere to write it.
   *
   * The team alert is silent here on purpose. The Slack transport is a
   * deployment credential this process does not read, and a report that
   * reaches the inbox without pinging a channel is a delayed alert, not a lost
   * report — the back office lists it either way.
   */
  private composeBugReports(tenancy: ApiResolvedTenancy): BugReportRestPorts | undefined {
    const database = this.composedDatabase?.connection;
    if (!database) return undefined;
    const reports = PrismaBugReportRepository.create({ prisma: database.client });
    return {
      reports: () => reports,
      // The process's ONE counter, the same one every other public rule meters
      // through: two limiters would give one address two flood budgets.
      rateLimiter: { consume: (input) => this.rateLimiter.consume(input) },
      notifier: new SilentBugReportNotifier(),
      credentials: (request) => extractApiKeyRequestCredentials(request),
      apiKeys: () => tenancy.apiKeys,
    };
  }

  /**
   * The one-click unsubscribe door's collaborators, or none.
   *
   * `undefined` where this process composed no org-group half, because the
   * automation application lives there. The address a caller is counted as is
   * resolved here rather than in the family: header priority is one half of
   * the answer and the raw socket address — which only the Node server's
   * connection info carries — is the other, and a family that read headers
   * alone would drop every caller sending none into one bucket.
   */
  private composeUnsubscribe(): UnsubscribeRestPorts | undefined {
    const automation = this.composedOrgGroup?.application.automation;
    if (!automation) return undefined;
    return {
      automation: () => automation,
      // The process's ONE counter: two limiters would give one address two
      // budgets for the same rule.
      rateLimit: (input) => this.rateLimiter.consume(input),
      clientAddress: (c) => apiClientAddress(c),
    };
  }

  /**
   * The Langy REST doors' collaborators, or none.
   *
   * Every one of them comes from a half this process already composed — the
   * application and its Redis from the agent group, the credential directory
   * from tenancy, the flag store from the product group — so this method
   * gathers rather than builds. The one thing it does decide is the ceiling:
   * the doors resolve their own credential (they must read the key's PROJECT
   * before they know whether the surface is open for it), so they take the
   * SAME `ApiHandlerManagedCredentials` the other handler-managed families
   * authenticate through rather than a second AuthZ read that could disagree.
   */
  private composeLangyRest(): ApiLangyRestComposition | undefined {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const authz = this.composedAuthz?.permissions ?? this.options.authz;
    if (!database || !tenancy || !authz) return undefined;
    const credentials = ApiHandlerManagedCredentials.create({
      apiKeys: tenancy.apiKeys,
      authz,
    });
    return composeApiLangyRest({
      langy: this.composedAgentGroup?.langy,
      apiKeys: tenancy.apiKeys,
      featureFlags: this.composedProductGroup?.featureFlagService,
      // The guarded client this process already opened, read through the two
      // fields the actor bridge selects. A second directory would be a second
      // answer to "who owns this key".
      actors: database.client,
      enforceCeiling: (input) => credentials.enforceCeiling(input),
      redis: this.composedQueueRedis,
      internalSecret: this.composedLangyInternalSecret,
      metrics: apiLangyRestMetrics(),
    });
  }

  /**
   * The GitHub App installation door's collaborators, or none.
   *
   * The session is the gate. `ApiAuthComposition` only exists where the
   * deployment handed this process a Better Auth transport, and both
   * `/install` and `/setup` are bound to the session that started the flow —
   * so without one the family is left off entirely rather than mounted with a
   * `/webhook` GitHub would never call.
   */
  private composeGithubRest(authz: AuthzService): GithubRestPorts | undefined {
    const auth = this.composedAuth?.compose();
    return composeApiGithubRest({
      github: this.composedGatewayGroup?.application.github,
      session: auth
        ? (request) =>
            AuthSessionApiAuthenticationAdapter.create(auth).authenticate(request)
        : undefined,
      authz,
      audit: this.options.audit,
    });
  }

  /**
   * Bridges the packaged families' management-audit port onto this process's
   * audit sink. The port names the action, not the URL, so the action is what
   * lands in `path` — it is the stable identifier of what was done.
   */
  private composeManagementAudit(): AppRestManagementAuditPort {
    const audit = this.options.audit;
    if (!audit) {
      return () => {};
    }
    const logger = createLogger("langwatch:api:management-audit");
    return (entry) => {
      void audit
        .record({
          actorId: entry.userId,
          path: entry.action,
          input: {
            organizationId: entry.organizationId,
            action: entry.action,
            ...(entry.args === undefined ? {} : { args: entry.args }),
          },
          error: null,
        })
        .catch((error) => {
          logger.error({ error, action: entry.action }, "Management audit failed");
        });
    };
  }

  /**
   * Binds the two API-owned ports to this process's parsed config and its
   * queue's Redis.
   *
   * The connection is read per call rather than captured: an absent queue
   * means an absent Redis, and the limiter's documented degradation is to
   * count in memory instead of refusing to count at all.
   */
  private composeFeaturePorts(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiOwnedRestFeaturePorts {
    const instanceAdminKey = ApiInstanceAdminKeyAdapter.create({ config: options.config });
    this.composedQueueRedis = queueInfrastructure?.redis;
    this.composedLangyInternalSecret = options.config.langyInternalSecret;
    return {
      instanceAdminKey: () => instanceAdminKey.read(),
      rateLimit: (request) => this.rateLimiter.consume(request),
    };
  }

  /**
   * Opens this process's ClickHouse and composes the analytics half of the
   * collaborator set over it.
   *
   * ClickHouse is optional and analytics is not conditional on it: a process
   * without one still composes the applications, and the charted reads refuse
   * at the call with the message they always had rather than the namespace
   * disappearing. What a missing ClickHouse must never do is leave the record
   * unmountable, because the same namespace also carries the workbench, whose
   * database is a different one entirely.
   */
  private composeAnalytics(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
  ): ApiAnalyticsCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    // The project service, and this process's OWN: three of the four things
    // below are project row reads — which organization a tenant routes to,
    // which organization a rollout flag targets, and which team a data-privacy
    // policy is inherited down from. A host that injected its own api-key and
    // organization pair composed no tenancy here, so it holds the collaborator
    // set whole and hands it in rather than having this half built for it.
    const projects = this.composedTenancy?.projects;
    if (!database || !projects) return undefined;

    this.composedClickHouse = ApiClickHouseInfrastructure.tryCreate({
      resources: options.resources,
      clickhouse: options.config.infrastructure.clickhouse,
      // The routing directory is the project service: which organization a
      // tenant belongs to is a project row, and it is the one question the
      // tenant router asks.
      directory: {
        organizationForTenant: async (tenantId) => await projects.getOrganizationId(tenantId),
      },
      report: LoggedApiClickHouseAbsence.create(createLogger(options.config.serviceName)),
    });

    return composeApiAnalyticsCollaborators({
      prisma: database.client,
      authz,
      projects,
      featureFlags: options.config.featureFlags,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      langWatchQL: options.config.infrastructure.clickhouse.langwatchQl,
      resources: options.resources,
    });
  }

  /**
   * Composes the identity half of the collaborator set.
   *
   * Everything it needs this process already holds: the guarded client, the
   * organization / project / API-key graph, the grant ledger, and the user
   * directory and Auth service the browser-session boundary composed. What it
   * cannot hold — the deployment's public host, its sign-in provider, its
   * operators and its mail gateway — arrives on the options, and each absence
   * is a named refusal on the one surface that needs it rather than a reason
   * the whole record goes missing.
   */
  private composeIdentity(
    options: ApiRuntimeCompositionOptions,
    auth: ApiAuthSessionCompositionPort,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiIdentityCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const projects = this.composedTenancy?.projects;
    const authz = this.composedAuthz;
    // A host that injected its own api-key and organization pair composed no
    // tenancy here, so it holds the collaborator set whole and hands it in
    // rather than having this half built for it.
    if (!database || !projects || !authz) return undefined;

    const session = auth.compose();
    return composeApiIdentityCollaborators({
      prisma: database.client,
      organizations: tenancy.organizations,
      projects,
      apiKeys: tenancy.apiKeys,
      grants: authz.grants,
      users: session.users,
      auth: session.auth,
      // The SAME Redis the queue owns: presence and the broadcast fan-out ride
      // the process's one connection rather than opening a second.
      redis: queueInfrastructure?.redis ?? null,
      // The SAME counter the public REST surface meters through, so a budget
      // cannot be spent twice by asking on two paths.
      rateLimit: (request) => this.rateLimiter.consume(request),
      eventing: ApiEventingIdentityAdapter.create(this.composedEventing),
      resources: options.resources,
      deployment: this.options.identity ?? {},
      mail: this.options.mail,
      processName: options.config.serviceName,
    });
  }

  /**
   * Composes the product half of the collaborator set.
   *
   * One gate, and it is the database: every port in this half is a row read
   * with a project or user id already in hand. The two capabilities it cannot
   * build for itself — the reviewer's trace content and the simulations step of
   * the setup checklist — arrive on the options and each degrades where it is
   * used rather than here, so neither can make four namespaces unmountable.
   *
   * The ClickHouse client is the SAME one the charted reads run on, opened once
   * by {@link composeAnalytics}. Only trace existence is read through it here,
   * and a second connection would be a second pool against one server.
   */
  private composeProduct(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
  ): ApiProductCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const projects = this.composedTenancy?.projects;
    const organizations = this.composedTenancy?.organizations;
    const users = this.composedAuth?.compose().users;
    // A host that injected its own api-key and organization pair composed no
    // tenancy here, so it holds the collaborator set whole and hands it in
    // rather than having this half built for it.
    if (!database || !projects || !organizations || !users) return undefined;

    return composeApiProductCollaborators({
      prisma: database.client,
      authz,
      projects,
      organizations,
      users,
      processName: options.config.serviceName,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      eventing: this.composedEventing?.eventSourcing,
      ...(this.options.traceContent ? { traceContent: this.options.traceContent } : {}),
      ...(this.options.simulations ? { simulations: this.options.simulations } : {}),
    });
  }

  /**
   * Composes the product-group half of the collaborator set.
   *
   * Two gates, and both are structural rather than optional capabilities: the
   * guarded client every row read below runs on, and the tenancy graph the
   * organization and project directories come out of. A host that injected its
   * own api-key and organization pair composed no tenancy here, so it holds the
   * collaborator set whole and hands it in rather than having this half built
   * for it.
   *
   * The model gateway is passed through where the process resolved one: a
   * stored prompt version records the model it was written against, and the
   * gateway is what turns that reference into the provider behind it. Its
   * absence costs that annotation and nothing else, which is why it does not
   * gate.
   */
  private composeProductGroup(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
  ): ApiProductGroupCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const projects = this.composedTenancy?.projects;
    const organizations = this.composedTenancy?.organizations;
    // The dataset service the execution half composed. Taken rather than built
    // so a project's rows have ONE service: the workflow and experiment
    // applications read them through the same one, and two would let
    // `dataset.getAll` disagree with an experiment's own row read.
    const execution = this.composedExecution;
    // The grant ledger custom-role bindings are written through: the SAME one
    // the AuthZ service reads decisions from, so a role granted here is a role
    // the next request's check can see.
    const grants = this.composedAuthz?.grants;
    if (!database || !projects || !organizations || !execution || !grants) return undefined;

    return composeApiProductGroupCollaborators({
      prisma: database.client,
      authz,
      organizations,
      projects,
      featureFlags: options.config.featureFlags,
      grants,
      datasets: execution.datasets,
      experimentLookup: execution.experimentLookup,
      evaluators: execution.evaluators,
      workflows: execution.workflows,
      ...(this.composedModelProviders ? { modelProviders: this.composedModelProviders } : {}),
    });
  }

  /**
   * Composes the product-infrastructure half over this process's own graph.
   *
   * Four things gate it, and none of them is optional for these three
   * surfaces: the database (the retention directory and the BYOC route lookup
   * are row reads), the execution half (the monitor and evaluator services a
   * monitor is listed, created and copied through), the product-group half
   * (the evaluator replication a monitor copy carries with it) and the trace
   * group (the retention service the settings page reads and writes). A host
   * that injected its own collaborator set composed none of them here and
   * holds the set whole.
   *
   * Everything else degrades where it is used rather than here — an absent
   * ClickHouse connection, an unregistered Azure driver, a missing plan
   * provider and the evaluation-run trend each refuse by name at the call. See
   * the absence report on
   * `api-trpc-collaborators.product-infra.composition.ts`.
   */
  private composeProductInfra(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
  ): ApiProductInfraCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const execution = this.composedExecution;
    const productGroup = this.composedProductGroup;
    const dataRetention = this.composedTraceGroup?.dataRetention;
    // The SAME operator allow-list `ctx.app.ops` carries, taken off the
    // identity half rather than parsed a second time: "who may keep data
    // forever" and "who sees the operator sidebar" must not be two answers.
    const ops = this.composedIdentity?.application.ops;
    if (!database || !execution || !productGroup || !dataRetention || !ops) return undefined;

    const half = composeApiProductInfraCollaborators({
      prisma: database.client,
      authz,
      dataRetention,
      monitors: execution.monitors,
      evaluators: execution.evaluators,
      evaluatorReplication: productGroup.evaluatorPorts,
      ops,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      storage: options.config.infrastructure.storedObjects,
      ...(this.options.plans ? { plans: this.options.plans } : {}),
      report: LoggedApiProductInfraAbsence.create(createLogger(options.config.serviceName)),
    });
    options.resources?.own("api stored-object aws clients", () => half.close());
    return half;
  }

  /**
   * Composes the agent half over this process's own graph.
   *
   * Five things gate it, and each one is read by more than one of the six
   * surfaces: the database (every scenario, suite and conversation is a row),
   * the tenancy graph (a suite resolves its project's organization and the
   * Langy rollout gate resolves the same), the agent directory (a suite's cases
   * run against one), the user directory (a run and a conversation both name
   * who started them) and the broadcast fabric (all three subscriptions stream
   * off it). A host that injected its own collaborator set composed none of
   * them here and holds the set whole.
   *
   * Everything else degrades where it is used rather than here — see the four
   * absences on `api-trpc-collaborators.agent-group.composition.ts`. That is
   * the same rule the trace half follows and for the same reason: a missing
   * queue must not make six namespaces unmountable, because three of them are
   * subscriptions that stream off this process's own emitter and one of them is
   * a compiled catalogue that reaches nothing at all.
   */
  private composeAgentGroup(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    encryption: SecretEncryptionPort | undefined,
  ): ApiAgentGroupCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const agents = this.composedAgents?.agents;
    const identity = this.composedIdentity;
    const auth = this.composedAuth?.compose();
    // The SAME flag store the `featureFlag.*` surface answers from, composed by
    // the product-group half. Taken rather than built: the Langy rollout gate
    // and the browser's own flag read must never disagree about whether an
    // account is inside the rollout.
    const featureFlags = this.composedProductGroup?.featureFlagService;
    if (!database || !tenancy || !agents || !identity || !auth || !encryption || !featureFlags) {
      return undefined;
    }

    return composeApiAgentGroupCollaborators({
      prisma: database.client,
      authz,
      agents,
      auth: auth.auth,
      // The SAME user directory the browser-session boundary composed: a run's
      // author and the person the session names must be one answer.
      users: auth.users,
      projects: tenancy.projects,
      organizations: tenancy.organizations,
      featureFlags,
      // The broadcast fabric presence already publishes on, read off the
      // identity half rather than composed again: all three of this half's
      // subscriptions and every presence event ride ONE emitter per tenant.
      broadcast: identity.application.broadcast,
      encryption,
      // The SAME routed ClickHouse the charted reads and the trace half use.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      redis: queueInfrastructure?.redis ?? null,
      // The SAME producer-only Eventing the trace and evaluation halves send
      // on. This half registers three more definitions against it — simulation,
      // suite run and Langy conversation — so a scenario run and a Langy write
      // reach the worker that drains them.
      eventing: this.composedEventing?.eventSourcing,
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      demoProjectId: options.config.authz.demoProjectId,
      // The SAME allow-list the identity half already parsed and published as
      // `config.opsSidebarEmails`. Taken rather than re-read: the operator gate
      // and the menu that shows the operator link must never disagree about who
      // is staff.
      adminEmails: identity.application.config.opsSidebarEmails ?? [],
      audit: this.options.audit,
      rateLimit: (request) => this.rateLimiter.consume(request),
      processName: options.config.serviceName,
      report: LoggedApiAgentGroupAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * Composes the observability half over this process's own graph.
   *
   * Two things gate it, and both are the same fact the record itself turns on:
   * a database, because every one of the sixteen surfaces is a row reader or is
   * composed from one, and the tenancy graph, because the share ledger, the
   * retention policy and the spend rollup all resolve a project's organization.
   * A host that injected its own api-key and organization pair composed no
   * tenancy here, so it holds the collaborator set whole and hands it in.
   *
   * Everything else degrades where it is used rather than here — see the four
   * absence ports on `api-trpc-collaborators.trace-group.composition.ts`. That
   * is the same rule the analytics half follows, and for the same reason: a
   * missing ClickHouse must not make sixteen namespaces unmountable, because
   * two of them are subscriptions that stream off this process's own emitter
   * and half a dozen more never touch a trace at all.
   */
  private composeTraceGroup(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    encryption: SecretEncryptionPort | undefined,
  ): ApiTraceGroupCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const grants = this.composedAuthz?.grants;
    // The broadcast fabric presence already publishes on. Read off the identity
    // half rather than composed again: both trace subscriptions and every
    // presence event ride ONE emitter per tenant, and two would leave a browser
    // watching a channel nothing writes to.
    const broadcast = this.composedIdentity?.application.broadcast;
    if (!database || !tenancy || !grants || !broadcast) return undefined;

    return composeApiTraceGroupCollaborators({
      prisma: database.client,
      authz,
      grants,
      projects: tenancy.projects,
      organizations: tenancy.organizations,
      broadcast,
      // The platform application's own floor. Stated rather than read from
      // config: the retention vertical has not moved, and defaulting to the
      // adapter's shorter value would silently shorten every project's window
      // on a deployment that never changed a setting.
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      // The SAME ClickHouse the charted reads run on, opened once by
      // `composeAnalytics`: a trace and its chart are rows in one routed
      // instance, and a second connection would be a second pool.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      // The SAME Redis the queue owns, which presence and the broadcast fan-out
      // already ride.
      redis: queueInfrastructure?.redis ?? null,
      modelProviders: this.resolveModelProviders(options, encryption),
      processName: options.config.serviceName,
      ...(this.options.traceReads ? { traceReads: this.options.traceReads } : {}),
      // The read stack, over the SAME retention cascade and topic tree the
      // group composes for its own surfaces: a span read's floor and a grid
      // row's topic label must be the ones the retention screen and the topic
      // page show, and a second of either would be a second answer.
      traceReadsFrom: ({ dataRetention, topics }) =>
        composeApiTraceReadStack({
          prisma: database.client,
          resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
          authz,
          projects: tenancy.projects,
          plans: this.resolvePlanProvider(options),
          dataRetention,
          topics,
          modelProviders: this.resolveModelProviders(options, encryption),
          // Where a resolved model executes: the NLP engine's
          // OpenAI-compatible proxy, the same one every other feature key
          // routes through.
          executionProxyBaseUrl: options.config.infrastructure.execution.nlpServiceUrl ?? "",
          // ANALYTICS's filter translator, joined here because a feature
          // package may not reach into another feature's server package. A
          // FILTERED legacy list refuses without it rather than answering the
          // unfiltered set, which would be a wider answer than asked for.
          filterConditions: (filters, window) =>
            generateClickHouseFilterConditions(filters as never, window),
          // The reserved-metadata amendment writes a span, on the SAME
          // `trace_processing` registration the product half made. Absent
          // where the process registered no queue, and then the amendment
          // refuses by name rather than reporting a write it dropped.
          ...(this.composedProduct
            ? { ingest: ApiTraceSpanIngestAdapter.create(this.composedProduct.traceCommands) }
            : {}),
          processName: options.config.serviceName,
        }),
      // Composed here rather than host-supplied: the vendor probes, the Codex
      // device flow and the cost-rule preview run behind the SAME egress fence
      // the gateway's own stored-credential probe does, so there is no address
      // reachable through the "test this key" form that the gateway refuses.
      modelProviderHost:
        this.options.modelProviderHost ??
        composeApiModelProviderHost({
          egress: {
            blockLocal: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
            allowedHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
            verifyTls: options.config.infrastructure.modelProvider.isSaas,
          },
          environment: options.config.infrastructure.modelProvider.environment,
          processName: options.config.serviceName,
        }),
      // The studio's streaming dispatch and the agent test's own trace write.
      // Composed here rather than host-supplied: both reach outside this
      // process — one to the NLP engine at the address the execution half
      // already dials, the other onto the SAME `trace_processing` registration
      // the product half made, because that pipeline may be registered once.
      studio:
        this.options.studio ??
        composeApiStudioHost({
          nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
          modelProviders: this.resolveModelProviders(options, encryption),
          ...(this.composedProduct
            ? {
                traceIngest: {
                  recordSpan: (data) =>
                    this.composedProduct!.traceCommands.recordSpan(data),
                },
              }
            : {}),
          processName: options.config.serviceName,
        }),
      // The usage reading and the plan it is taken against, both composed
      // here. ONE plan provider serves both, because the panel and every
      // banner that quotes an allowance must agree about which plan an
      // organization is on.
      usage:
        this.options.usage ??
        composeApiUsageStats({
          prisma: database.client,
          plans: this.resolvePlanProvider(options),
          resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
          processName: options.config.serviceName,
          report: this.entitlementAbsence(options),
        }),
      plans: this.options.plans ?? this.resolvePlanProvider(options),
      report: LoggedApiTraceGroupAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * Composes the org-group half over this process's own graph.
   *
   * Five things gate it, and each is a fact the nine surfaces turn on: a
   * database, because every one of them is a row reader; the tenancy graph,
   * because every one of them resolves an organization or a project; the
   * analytics application, because a graph automation is evaluated against a
   * charted read; the product-group half's flag store, because the webhook
   * channel is behind a rollout; and the observability half, because a
   * project's sharing rule and its topic tree are ONE each and this half must
   * read the same ones the explorer does. A host that injected its own
   * collaborator set composed none of those here and holds the set whole.
   *
   * Everything else degrades where it is USED rather than here — the
   * invitation service, the protections resolver, the Enterprise application
   * and the GitHub App each name their own absence at the call, so a
   * deployment missing one of them still administers its tenant.
   */
  private composeOrgGroup(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    encryption: SecretEncryptionPort | undefined,
  ): ApiOrgGroupCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const featureFlags = this.composedProductGroup?.featureFlagService;
    const traceGroup = this.composedTraceGroup;
    // The evaluator service the execution half composed, for the monitor
    // directory below: taken rather than built so a monitor's evaluator and
    // the `evaluators.*` surface cannot disagree about what one runs.
    const evaluators = this.composedExecution?.evaluators;
    if (!database || !tenancy || !featureFlags || !traceGroup || !evaluators) return undefined;

    return composeApiOrgGroupCollaborators({
      prisma: database.client,
      authz,
      organizations: tenancy.organizations,
      projects: tenancy.projects,
      apiKeys: tenancy.apiKeys,
      // Taken rather than built: a second share ledger or topic tree would let
      // the settings form and the explorer disagree about what a project holds.
      share: traceGroup.share,
      topics: traceGroup.topics,
      monitors: this.resolveMonitors(database.client, evaluators),
      featureFlags,
      // The SAME plan provider the usage panel and every allowance banner
      // read, for the automation persist ceiling and both Enterprise gates.
      plans: this.resolvePlanProvider(options),
      encryption,
      audit: this.options.audit,
      // The SAME Redis the queue owns, which the worker spends the automation
      // persist ceiling against.
      redis: queueInfrastructure?.redis ?? null,
      // The process's ONE counter: two limiters would give a caller two budgets.
      rateLimit: (input) => this.rateLimiter.consume(input),
      unsubscribeSecret: options.config.storedSecretEncryptionKey,
      baseHost: options.config.infrastructure.execution.publicBaseUrl ?? "",
      demoProject: {
        userId: options.config.authz.demoProjectUserId ?? "",
        projectId: options.config.authz.demoProjectId ?? "",
      },
      github: this.resolveGithub(options, database.client, queueInfrastructure, tenancy),
      // The SAME ClickHouse the charted reads and the traces run on: a
      // coding-agent session is a projection in that instance, and a second
      // connection would be a second pool.
      codingAgentClickHouse: this.resolveCodingAgentClickHouse(),
      ...(this.options.organizationInvites
        ? { invites: this.options.organizationInvites }
        : {}),
      ...(this.options.viewerProtections
        ? { viewerProtections: this.options.viewerProtections }
        : {}),
      ...(this.options.enterprise ? { enterprise: this.options.enterprise } : {}),
      processName: options.config.serviceName,
    });
  }

  /**
   * The gateway-group half, over this process's own graph.
   *
   * It needs four things nothing else on this composition can stand in for: the
   * evaluator service a guardrail runs, the monitor directory an attachment
   * names, this process's ClickHouse — where the spend ledger is projected —
   * and its flag store, which the `/` landing decision reads the governance
   * rollout from. Absent any of them there is no gateway to administer, so the
   * half is absent and the seal names it rather than mounting twenty-two
   * namespaces over the gap.
   */
  private composeGatewayGroup(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiGatewayGroupCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const featureFlags = this.composedProductGroup?.featureFlagService;
    const evaluators = this.composedExecution?.evaluators;
    if (!database || !tenancy || !featureFlags || !evaluators) return undefined;

    return composeApiGatewayGroupCollaborators({
      prisma: database.client,
      authz,
      projects: tenancy.projects,
      apiKeys: tenancy.apiKeys,
      evaluators,
      // The SAME monitor directory the automation application and the monitor
      // surface read: a guardrail attachment and the monitor page it points at
      // must agree about what one runs.
      monitors: this.resolveMonitors(database.client, evaluators),
      featureFlags,
      // The SAME plan provider every allowance banner reads, for the landing
      // decision's Enterprise test.
      plans: this.resolvePlanProvider(options),
      github: this.resolveGithub(options, database.client, queueInfrastructure, tenancy),
      audit: this.options.audit,
      // The SAME ClickHouse the charted reads and the traces run on: the
      // gateway ledger is a projection in that instance, and a second
      // connection would be a second pool.
      clickhouse: this.resolveGatewayClickHouse(),
      virtualKeyPepper: options.config.virtualKeyPepper,
      // One variable, one meaning: `IS_SAAS` is what decides whether this
      // installation bills through Stripe, and it is read from the one leaf
      // that already carries it rather than from a second of its own.
      saasBilling: options.config.infrastructure.modelProvider.isSaas,
      ...(this.options.gatewayIdempotency
        ? { idempotency: this.options.gatewayIdempotency }
        : {}),
      ...(this.options.enterprise ? { enterprise: this.options.enterprise } : {}),
      processName: options.config.serviceName,
    });
  }

  /**
   * The gateway ledger's ClickHouse, over this process's own resolution.
   *
   * `null` where the process opened none, which is a supported shape rather
   * than a degradation: spend is a projection in that instance, and a
   * deployment holding no trace storage has no spend to price a budget
   * against — the application answers `spend_source_unavailable` by name.
   */
  private resolveGatewayClickHouse() {
    const clickhouse = this.composedClickHouse;
    if (!clickhouse) return null;
    return { resolve: (tenantId: string) => clickhouse.resolveClient(tenantId) };
  }

  /**
   * The coding-agent session store, over this process's own ClickHouse.
   *
   * `null` where the process opened none, which is a supported shape rather
   * than a degradation: a session is a projection in that instance, and a
   * deployment holding no trace storage holds no session to read.
   */
  private resolveCodingAgentClickHouse() {
    const clickhouse = this.composedClickHouse;
    if (!clickhouse) return null;
    return { resolve: (tenantId: string) => clickhouse.resolveClient(tenantId) };
  }

  /**
   * The monitor directory, memoized.
   *
   * One instance because two callers ask for it — the automation application
   * names the monitors a trigger watches, and the monitor surface reads the
   * same rows — and two would let a trigger's label disagree with the monitor
   * page it points at.
   */
  private resolveMonitors(
    prisma: PrismaConnection["client"],
    evaluators: EvaluatorService,
  ): MonitorService {
    if (this.composedMonitors) return this.composedMonitors;
    this.composedMonitors = PostgresMonitorAdapter.create({
      database: prisma,
      evaluators,
      generateId: () => nanoid(),
    });
    return this.composedMonitors;
  }

  /**
   * The GitHub App this deployment registered, composed from configuration.
   *
   * Composed unconditionally, blank credentials included: the feature's own
   * `configured` flag is what turns an install with no App into "not
   * connected" on the connection screen, which is true rather than degraded. A
   * refusal here would instead make every coding-agent read fail on a
   * deployment that simply never registered one.
   */
  private resolveGithub(
    options: ApiRuntimeCompositionOptions,
    prisma: PrismaConnection["client"],
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    tenancy: ApiTenancyComposition,
  ): GithubService {
    // Memoized: two halves ask for it — the org group's coding-agent reads and
    // the gateway group's `github.*` surface — and two adapters would be two
    // installation caches over one App.
    if (this.composedGithub) return this.composedGithub;
    const github = options.config.infrastructure.github;
    this.composedGithub = PostgresGithubAdapter.create({
      database: prisma,
      config: {
        appId: github.appId,
        privateKey: github.privateKey,
        appSlug: github.appSlug,
        webhookSecret: github.webhookSecret,
        // The same key every other stored credential on this deployment is
        // sealed with: an install state signed by one process and verified by
        // another has to be the same signature.
        signingKey: options.config.storedSecretEncryptionKey ?? "",
      },
      ...(github.host === undefined ? {} : { hostConfig: { host: github.host } }),
      redis: queueInfrastructure?.redis ?? null,
      organization: tenancy.organizations,
      project: tenancy.projects,
    });
    return this.composedGithub;
  }

  /**
   * The one plan provider this process resolves every allowance through.
   *
   * Memoized for the reason the model gateway is: two callers ask for it — the
   * usage reading and the `plan.getActivePlan` surface — and two providers
   * would be two answers to "which plan is this organization on", which is the
   * disagreement a customer sees as a banner contradicting the usage panel.
   */
  private resolvePlanProvider(options: ApiRuntimeCompositionOptions): PlanProvider {
    if (this.composedPlanProvider) return this.composedPlanProvider;
    this.composedPlanProvider = composeApiPlanProvider({
      isSaas: options.config.infrastructure.modelProvider.isSaas,
      report: this.entitlementAbsence(options),
    });
    return this.composedPlanProvider;
  }

  /** One report for every entitlement absence, named once per process. */
  private entitlementAbsence(
    options: ApiRuntimeCompositionOptions,
  ): LoggedApiEntitlementAbsence {
    this.composedEntitlementAbsence ??= apiEntitlementAbsenceReport(options.config.serviceName);
    return this.composedEntitlementAbsence;
  }

  /**
   * The model gateway this process serves, and where it came from.
   *
   * Precedence, and the reason for it:
   *
   *  1. An injected service wins, for the reason every other injected service
   *     wins here — one gateway per process, and a test binding a double is
   *     asking for the double.
   *  2. Otherwise this process composes its own over the guarded client, the
   *     project / organization / AuthZ graph it already holds and the SAME
   *     stored-secret cipher its secret service is built on. A provider
   *     credential written by any process in the deployment decrypts here, and
   *     one written here decrypts there, because it is one cipher and one
   *     format.
   *
   * Three things can leave it absent, and they are told apart at boot: no
   * database, no tenancy graph, and no `CREDENTIALS_SECRET`. The third is the
   * interesting one — every stored credential is encrypted, so a gateway
   * without the cipher would report every configured provider as unusable
   * rather than failing honestly, which is why it gates instead of degrading.
   */
  private resolveModelProviders(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
  ): ModelProviderService | undefined {
    if (this.options.modelProviders) return this.options.modelProviders;
    // Memoized: two halves ask for it — the execution half for the studio's
    // model calls, the observability half for the provider surface itself —
    // and a second gateway would be a second pool of provider connections and
    // a second decryption of the same stored credentials.
    if (this.composedModelProviders) return this.composedModelProviders;

    const absence = LoggedApiModelProviderAbsence.create(
      createLogger(options.config.serviceName),
    );
    const database = this.composedDatabase?.connection;
    if (!database) {
      absence.absent("no-database");
      return undefined;
    }
    const tenancy = this.composedTenancy;
    const authz = this.composedAuthz;
    if (!tenancy || !authz) {
      absence.absent("no-tenancy");
      return undefined;
    }
    if (!encryption) {
      absence.absent("no-encryption");
      return undefined;
    }

    this.composedModelProviders = composeApiModelProviders({
      prisma: database.client,
      projects: tenancy.projects,
      organizations: tenancy.organizations,
      authorization: authz.permissions,
      encryption,
      // The SAME counter every other metered path spends against, so a
      // connection-test budget cannot be spent twice by asking on two paths.
      rateLimit: (request) => this.rateLimiter.consume(request),
      environment: options.config.infrastructure.modelProvider.environment,
      isSaas: options.config.infrastructure.modelProvider.isSaas,
      egress: {
        blockLocal: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
        allowedHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
        // Tied to the hosted flag rather than to the address policy: an
        // on-prem install calling a service with a self-signed certificate is
        // a different question from whether private addresses are reachable.
        verifyTls: options.config.infrastructure.modelProvider.isSaas,
      },
      nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
      processName: options.config.serviceName,
    });
    return this.composedModelProviders;
  }

  /**
   * Composes the execution half of the collaborator set over this process's
   * own graph.
   *
   * Three things gate it, and each absence is a different fact:
   *
   *  - the DATABASE, because every service below is a row reader;
   *  - the AGENT service, because a wizard experiment resolves the agents its
   *    targets name and the reference set takes one;
   *  - the MODEL GATEWAY, which this process now composes for itself and can
   *    only miss for one reason — no stored-secret cipher, so not a single
   *    provider credential could be read. See {@link resolveModelProviders}.
   *
   * Everything else is optional and degrades where it is used rather than
   * here: no ClickHouse means a run history refuses at the call, no NLP
   * address means nothing executes, no queue means a re-score cannot be
   * reported, and no cipher means a project's run secrets cannot be decrypted.
   * None of them makes the four namespaces unmountable, because each is a
   * capability of one operation rather than of the surface.
   *
   * The TENANCY graph and the QUEUE are passed for the workbench run loop
   * composed inside it: a run mints its sandbox key through the same API-key
   * service every other credential goes through, and its abort flag and
   * progress live in the same Redis the queue owns. Neither gates this half —
   * a process with no Redis mounts every namespace and refuses only to START a
   * run, by name.
   */
  private composeExecution(
    options: ApiRuntimeCompositionOptions,
    agents: AgentService | undefined,
    encryption: SecretEncryptionPort | undefined,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiExecutionCollaborators | undefined {
    const database = this.composedDatabase?.connection;
    const modelProviders = this.resolveModelProviders(options, encryption);
    // Held so the product-group half reads the SAME gateway rather than
    // composing a second: a stored prompt version's model reference and a
    // studio node's model must resolve to one provider, not to two.
    this.composedModelProviders = modelProviders;
    if (!database || !agents || !modelProviders) {
      LoggedApiExecutionAbsence.create(createLogger(options.config.serviceName)).absent({
        database: Boolean(database),
        agents: Boolean(agents),
        modelProviders: Boolean(modelProviders),
      });
      return undefined;
    }

    return composeApiExecutionCollaborators({
      prisma: database.client,
      processName: options.config.serviceName,
      modelProviders,
      agents,
      // The SAME ClickHouse the charted reads run on, opened once by
      // {@link composeAnalytics}: an experiment's run history and an
      // evaluation's analytics are rows in that same routed instance, and a
      // second connection would be a second pool against one server.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
      publicBaseUrl: options.config.infrastructure.execution.publicBaseUrl,
      secretDecryptor: encryption,
      eventing: this.composedEventing?.eventSourcing,
      // The SAME Redis the queue owns, which the workbench run's abort flag
      // and its progress both live in: a stop asked for on one replica has to
      // reach the loop running on another, and a poll has to find the run
      // whichever replica takes it.
      redis: queueInfrastructure?.redis ?? null,
      // The SAME API-key service every credential in this process is minted
      // and verified through: a run's sandbox key is a narrower key, not a
      // second kind of key.
      apiKeys: tenancy.apiKeys,
      experimentRunReport: LoggedApiExperimentRunAbsence.create(
        createLogger(options.config.serviceName),
      ),
    });
  }

  private composeQueue(options: ApiRuntimeCompositionOptions): ApiQueueInfrastructure | undefined {
    const logger = createLogger(options.config.serviceName);
    return ApiQueueInfrastructure.tryCreate({
      resources: options.resources,
      redis: options.config.infrastructure.redis,
      redisLogger: logger,
      queuePolicy: options.config.infrastructure.groupQueue,
      storage: this.options.queueStorage,
      report: LoggedApiQueueAbsence.create(logger),
    });
  }
}

/**
 * Composes the process's guarded Prisma connection from its validated config.
 *
 * A named step rather than an inline one because the client is the seam every
 * packaged `Postgres*Adapter` below takes, and there is exactly one way to
 * build it: through the packaged construction path, with the packaged tenancy
 * guard. Nothing in this process can ask for a client without them.
 */
function composeApiDatabase(
  options: ApiRuntimeCompositionOptions,
): ApiDatabaseInfrastructure | undefined {
  const logger = createLogger(options.config.serviceName);
  return ApiDatabaseInfrastructure.tryCreate({
    resources: options.resources,
    database: options.config.infrastructure.database,
    nodeEnvironment: options.config.nodeEnvironment,
    report: LoggedApiDatabaseAbsence.create(logger),
  });
}

/**
 * Composes the process's stored-secret cipher from its validated key.
 *
 * Separate from {@link composeApiDatabase} because the two absences are
 * different facts: a deployment can have a database and no key, or a key and
 * no database, and each one is worth naming on its own.
 */
function composeApiSecretEncryption(
  options: ApiRuntimeCompositionOptions,
): ApiSecretEncryptionInfrastructure | undefined {
  const logger = createLogger(options.config.serviceName);
  return ApiSecretEncryptionInfrastructure.tryCreate({
    key: options.config.storedSecretEncryptionKey,
    report: LoggedApiSecretEncryptionAbsence.create(logger),
  });
}

/**
 * The metrics transport this process serves scrapes from, and where it came
 * from.
 *
 * Precedence, and the reason for it:
 *
 *  1. An injected transport wins. A host that already owns the product graph
 *     owns one registry per process, and handing this process a second one to
 *     render would split the samples between two scrape bodies.
 *  2. Otherwise the process composes its own over the registry its packages
 *     already write into, gated by the credential it was configured with.
 *  3. With neither — no host transport, and no key in production — there is no
 *     transport, and `/metrics` is not mounted at all. Absent, so a scrape is
 *     answered "no such route" rather than by a door that refuses every caller
 *     it will ever have.
 *
 * Decided once, here, so a process serving product transports and one serving
 * only its lifecycle surface answer a scrape by the same rule.
 */
function resolveApiMetrics(input: {
  options: ApiRuntimeCompositionOptions;
  injected: ApiMetricsPort | undefined;
}): ApiMetricsPort | undefined {
  if (input.injected) return input.injected;

  const logger = createLogger(input.options.config.serviceName);
  return ApiMetricsInfrastructure.tryCreate({
    key: input.options.config.metricsApiKey,
    nodeEnvironment: input.options.config.nodeEnvironment,
    report: LoggedApiMetricsAbsence.create(logger),
  })?.metrics;
}

/** Names the absent credential once, at boot, rather than leaving it to be inferred. */
export class LoggedApiMetricsAbsence extends ApiMetricsAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiMetricsAbsence {
    return new LoggedApiMetricsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without a metrics credential in production: it serves no metrics endpoint",
    );
  }
}

/** Names the absent key once, at boot, rather than leaving it to be inferred. */
export class LoggedApiSecretEncryptionAbsence extends ApiSecretEncryptionAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiSecretEncryptionAbsence {
    return new LoggedApiSecretEncryptionAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without a stored-secret key: it can neither read nor write project secrets",
    );
  }
}

/** Names the absent database once, at boot, rather than leaving it to be inferred. */
export class LoggedApiDatabaseAbsence extends ApiDatabaseAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiDatabaseAbsence {
    return new LoggedApiDatabaseAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without Postgres: no guarded Prisma client exists in this process",
    );
  }
}

/** Names the absent analytics store once, at boot, with what it costs. */
export class LoggedApiClickHouseAbsence extends ApiClickHouseAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiClickHouseAbsence {
    return new LoggedApiClickHouseAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "unconfigured" },
      "API composed without ClickHouse: the charted analytics reads and the filter pickers refuse at the call. The LangWatchQL workbench is unaffected — it runs on its own restricted identity.",
    );
  }
}

/**
 * Names which of the execution half's three preconditions this process is
 * missing, once, at boot.
 *
 * Named individually rather than as one "not composed": a deployment with no
 * database has a different problem from one that simply has not handed in a
 * model gateway yet, and an operator reading "no packaged tRPC namespaces"
 * without this line has no way to tell them apart.
 */
export class LoggedApiExecutionAbsence {
  static create(logger: Pick<Logger, "info">): LoggedApiExecutionAbsence {
    return new LoggedApiExecutionAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {}

  absent(present: { database: boolean; agents: boolean; modelProviders: boolean }): void {
    const missing = [
      present.database ? undefined : "a database",
      present.agents ? undefined : "an agent service",
      present.modelProviders ? undefined : "a model gateway",
    ].filter((entry): entry is string => entry !== undefined);
    if (missing.length === 0) return;
    this.logger.info(
      { missing },
      `API composed without ${missing.join(" and ")}: it serves no workflow, optimization, experiment or evaluation surfaces.`,
    );
  }
}

/** Names the absent dispatch once, at boot, rather than leaving it to be inferred. */
export class LoggedApiEventingAbsence extends ApiEventingAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiEventingAbsence {
    return new LoggedApiEventingAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(): void {
    this.logger.info(
      { reason: "no-queue" },
      "API composed without a Group Queue: it can produce no commands, so it composes no service whose writes are commands",
    );
  }
}

/** Names the absent AuthZ once, at boot, rather than leaving it to be inferred. */
export class LoggedApiAuthzAbsence extends ApiAuthzAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiAuthzAbsence {
    return new LoggedApiAuthzAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-database" | "no-eventing"): void {
    this.logger.warn(
      { reason },
      "API composed no AuthZ service and no host supplied one: it mounts no product transports, because every route it would mount is authorized",
    );
  }
}

/**
 * Names what the agent service is missing once, at boot, rather than leaving it
 * to be inferred.
 *
 * Two different facts, so two different lines. No client means no agent service
 * and no agents door at all. A composed service with no workflow-copy
 * capability is a door that serves every operation but one, and a deployment
 * should read that in its own logs rather than on the first copy of a workflow
 * agent.
 */
export class LoggedApiAgentsAbsence extends ApiAgentsAbsenceReportPort {
  static create(logger: Pick<Logger, "info" | "warn">): LoggedApiAgentsAbsence {
    return new LoggedApiAgentsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info" | "warn">) {
    super();
  }

  absent(reason: "no-database"): void {
    this.logger.warn(
      { reason },
      "API composed no agent service and no host supplied one: it mounts no agents surface, because every operation on it reads the agent rows",
    );
  }

  withoutWorkflowCopies(): void {
    this.logger.info(
      { reason: "no-workflow-application" },
      "API composed its agent service without a workflow-copy capability: every agent operation is served except copying a workflow agent, which needs the Studio graph this process does not compose",
    );
  }
}

/** Names the absent Auth graph once, at boot, rather than leaving it inferred. */
export class LoggedApiAuthAbsence extends ApiAuthAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiAuthAbsence {
    return new LoggedApiAuthAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-database" | "no-tenancy" | "no-browser-session-transport"): void {
    this.logger.warn(
      { reason },
      reason === "no-browser-session-transport"
        ? "API composed no browser-session transport and no host supplied an Auth composition: it can authenticate no browser caller, so it mounts no transports that authenticate one. Supply the deployment's Better Auth instance — this process cannot compose a second one that verifies the same cookies"
        : "API composed no Auth service and no host supplied one: it can authenticate no browser caller, so it mounts no transports that authenticate one",
    );
  }
}

/** Names the absent credential services once, at boot, rather than leaving them inferred. */
export class LoggedApiTenancyAbsence extends ApiTenancyAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiTenancyAbsence {
    return new LoggedApiTenancyAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-database" | "no-authz" | "no-pepper"): void {
    this.logger.warn(
      { reason },
      "API composed no organization or API-key service and no host supplied them: it mounts no product transports, because every route it would mount resolves a credential",
    );
  }
}

/** Names the absent Redis once, at boot, rather than leaving it to be inferred. */
export class LoggedApiQueueAbsence extends ApiQueueAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiQueueAbsence {
    return new LoggedApiQueueAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  absent(reason: "disabled" | "unconfigured"): void {
    this.logger.info(
      { reason },
      "API composed without Redis: Group Queue dispatch and the Redis readiness gate are absent",
    );
  }
}

/**
 * Names the workbench run loop's own absences once, at boot.
 *
 * Both are worth a line rather than an inference, because the surfaces they
 * disable still mount and answer every read: a deployment reads here that it
 * cannot start a run, instead of on the first person who presses Run.
 */
export class LoggedApiExperimentRunAbsence extends ApiExperimentRunAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiExperimentRunAbsence {
    return new LoggedApiExperimentRunAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutProgressStore(): void {
    this.logger.warn(
      { reason: "no-redis" },
      "API composed no workbench run loop: with no Redis a started run has nowhere to record its progress, so a poll could never find it. Every experiments surface still answers; only starting a run refuses",
    );
  }

  withoutPublicBaseUrl(): void {
    this.logger.warn(
      { reason: "no-public-base-url" },
      "API composed no workbench run loop: with no public base URL a run cannot answer with the link to its own results. Set BASE_HOST",
    );
  }
}

/**
 * Composes the process with only its own lifecycle surface mounted.
 *
 * The one destination for every way this process can end up with no product
 * transports — no AuthZ, no credential pair, no way to authenticate a browser
 * caller — so a deployment's health route, metrics gate, readiness order and
 * drain behaviour do not depend on WHICH of those gaps it has.
 */
function composeApiLifecycleProcess(input: {
  options: ApiRuntimeCompositionOptions;
  metrics: ApiMetricsPort | undefined;
  readiness: ApiReadinessPort | undefined;
  featureDrain: ApiFeatureDrainPort | undefined;
}): ApiRuntimeProcessPort {
  const routes = ApiProcessLifecycleRoutes.create(input.metrics ? { metrics: input.metrics } : {});
  const observability = createProcessObservability(input.options.observability);
  return ApiLifecycleOnlyProcess.create({
    listener: ApiHttpListener.create({
      application: routes,
      host: input.options.config.host,
      port: input.options.config.port,
      drainGraceMs: input.options.config.httpDrainGraceMs,
      logger: observability.logger,
    }),
    observability,
    graph: input.options.graph,
    readiness: input.readiness,
    featureDrain: input.featureDrain,
  });
}

/**
 * The API process with only its own lifecycle surface mounted. It keeps the
 * readiness-before-listen order and the shared finalization order so a
 * deployment's shutdown behaviour does not change when the product transports
 * are added.
 */
class ApiLifecycleOnlyProcess extends ApiRuntimeProcessPort {
  static create(options: {
    listener: ApiHttpListener;
    observability: ProcessObservability;
    graph: ApiProcessGraphPort;
    readiness: ApiReadinessPort | undefined;
    featureDrain: ApiFeatureDrainPort | undefined;
  }): ApiLifecycleOnlyProcess {
    return new ApiLifecycleOnlyProcess(options);
  }

  private closing: Promise<void> | undefined;

  private constructor(
    private readonly options: {
      listener: ApiHttpListener;
      observability: ProcessObservability;
      graph: ApiProcessGraphPort;
      readiness: ApiReadinessPort | undefined;
      featureDrain: ApiFeatureDrainPort | undefined;
    },
  ) {
    super();
  }

  async start(): Promise<{ host: string; port: number }> {
    await this.options.readiness?.assertReady();
    return this.options.listener.start();
  }

  close(): Promise<void> {
    this.closing ??= closeApiProcessResources({
      listener: this.options.listener,
      featureDrain: this.options.featureDrain,
      graph: this.options.graph,
      observability: this.options.observability,
    });
    return this.closing;
  }
}

/** The real listener/process whose close sequence owns graph and telemetry shutdown. */
class ApiProductionProcess extends ApiRuntimeProcessPort {
  static create(process: ApiProcess): ApiProductionProcess {
    return new ApiProductionProcess(process);
  }

  private constructor(private readonly process: ApiProcess) {
    super();
  }

  start(): Promise<{ host: string; port: number } | undefined> {
    return this.process.start();
  }

  close(): Promise<void> {
    return this.process.close();
  }
}

/**
 * Writes the entries a collaborator set is missing to the process log.
 *
 * Named one by one on purpose. "The record did not mount" is a symptom every
 * half shares; "no `evaluations` entry and no `application.workflows` slice" is
 * the execution half, and an operator can act on that without reading a
 * composition.
 */
export class LoggedApiCollaboratorGap extends ApiTrpcCollaboratorGapReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiCollaboratorGap {
    return new LoggedApiCollaboratorGap(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  incomplete(missing: readonly string[]): void {
    this.logger.warn(
      { missing },
      `API process composed an incomplete tRPC collaborator set, so it serves no packaged namespaces: ${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} never filled by any half.`,
    );
  }
}


/**
 * The reserved-metadata amendment's span write, over the process's own
 * `trace_processing` registration.
 *
 * A thin adapter rather than the sender itself: the read stack declares a port
 * whose one method is typed as the command, and the registration hands back an
 * untyped dispatcher. Naming the seam here is what keeps the cast in ONE place
 * rather than at every call.
 */
class ApiTraceSpanIngestAdapter extends TraceSpanIngestPort {
  static create(commands: ApiTraceProducerCommands): ApiTraceSpanIngestAdapter {
    return new ApiTraceSpanIngestAdapter(commands);
  }

  private constructor(private readonly commands: ApiTraceProducerCommands) {
    super();
  }

  recordSpan(data: RecordSpanCommandData): Promise<void> {
    return this.commands.recordSpan(data);
  }
}
