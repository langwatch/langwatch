import { EnterpriseApiAuditLog, EnterpriseApiSso, type ScimApi } from "@langwatch/enterprise-api";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { LocalFeatureApis, type BootedRuntime } from "@langwatch/runtime-composition";
import { AgentApi } from "@langwatch/agent-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import type { RedisConnection } from "@langwatch/redis-client";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservability,
} from "@langwatch/observability/node";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzGrantsService, AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { OrganizationApi, type OrganizationService } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { bindTenantDirectoryReader } from "@langwatch/organization-server";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { Hono } from "hono";
import { register } from "prom-client";
import {
  ApiAuditPort,
  ApiRequestPolicy,
  AuthzApiAuthorizationAdapter,
} from "../api-request.policy.ts";
import {
  ApiFeatureDrainPort,
  ApiProcess,
  ApiProcessGraphPort,
  closeApiProcessResources,
} from "../api.process.ts";
import { ApiHttpListener } from "../api-http.listener.ts";
import {
  CompositeApiRawSurface,
  tryCreateApiStaticSurface,
} from "../app-static/app-static.surface.ts";
import { tryCreateHostedMcpSurface } from "../features/mcp/hosted-mcp.mount.ts";
import {
  ApiMetricsPort,
  ApiProcessLifecycleRoutes,
  ApiReadinessPort,
} from "../api-process.lifecycle.ts";
import {
  ApiDatabaseAbsenceReportPort,
  ApiDatabaseInfrastructure,
} from "../platform/infrastructure/api-database.infrastructure.ts";
import {
  ApiQueueAbsenceReportPort,
  ApiQueueInfrastructure,
} from "../platform/infrastructure/api-queue.infrastructure.ts";
import {
  ApiEventingAbsenceReportPort,
  ApiEventingInfrastructure,
} from "../platform/infrastructure/api-eventing.infrastructure.ts";
import {
  ApiClickHouseAbsenceReportPort,
  ApiClickHouseInfrastructure,
} from "../platform/infrastructure/api-clickhouse.infrastructure.ts";
import { PostgresBillingAdapter } from "@langwatch/enterprise-billing-server";
import { PostgresOrganizationLicenseAdapter } from "@langwatch/enterprise-licensing-server";
import { installApiAgent, type ApiAgentComposition } from "./api-agents.composition.ts";
import { ApiConnectedAgentsComposition } from "./api-connected-agents.composition.ts";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import type { AgentInfrastructure } from "@langwatch/agent-server";
import { ApiUpgradeRouter } from "../api-upgrade-router.ts";
import { installApiDataset } from "../features/dataset/dataset.composition.ts";
import { installApiEvaluator } from "../features/evaluator/evaluator.composition.ts";
import { installApiPrompt } from "../features/prompt/prompt.composition.ts";
import { EventingKillSwitchAdapter } from "@langwatch/feature-flag-server";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { installApiFeatureFlag } from "../features/feature-flag/feature-flag.composition.ts";
import {
  composeAnalyticsFeature,
  refusingAnalyticsFeature,
} from "../features/analytics/analytics.composition.ts";
import {
  composeAuthFeature,
  resolvePersonDeploymentFacts,
  type ApiPersonDeploymentFacts,
} from "../features/auth/auth.composition.ts";
import { installApiUser, refusingUserFeature } from "../features/user/user.composition.ts";
import { installApiPresence } from "../features/presence/presence.composition.ts";
import { BroadcastAdapter } from "@langwatch/presence-server";
import { composeApiKeyFeature } from "../features/api-key/api-key.composition.ts";
import type { ApiPersonMailPort } from "./api-person-mail.port.ts";
import { ApiEventingIdentityAdapter } from "./api-identity-eventing.adapter.ts";
import {
  composeApiIdentityPipelines,
  LoggedApiIdentityPipelinesAbsence,
} from "./api-identity-pipelines.composition.ts";
import {
  composeWorkflowCommitMessages,
  composeWorkflowFeature,
  composeWorkflowRuntime,
  refusingWorkflowFeature,
  type ApiWorkflowRuntime,
} from "../features/workflow/workflow.composition.ts";
import {
  composeExperimentFeature,
  refusingExperimentFeature,
} from "../features/experiment/experiment.composition.ts";
import type { EvaluationClickHouseResolver } from "@langwatch/evaluation-server";
import { installApiEvaluation } from "../features/evaluation/evaluation.composition.ts";
import {
  composeApiEvaluatorExecution,
  LoggedApiEvaluatorExecutionAbsence,
  type ApiEvaluatorExecution,
} from "./api-evaluator-execution.composition.ts";
import {
  composeTraceFeature,
  LoggedApiTraceAbsence,
  refusingTraceFeature,
} from "../features/trace/trace.composition.ts";
import type { ApiTraceReadStackPort } from "../features/trace/trace-read-stack.port.ts";
import { installApiShare } from "../features/share/share.composition.ts";
import { installApiTopic } from "../features/topic/topic.composition.ts";
import {
  ApiSsoGateLogger,
  ApiUnavailableSsoConnectionLedger,
} from "../features/sso/sso-process.ports.ts";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  EntitlementService,
  PrismaUsageMembershipRepository,
  type EntitlementServiceOptions,
  type UsageService,
  type UsageWarningPort,
} from "@langwatch/entitlement-server";

import {
  composeApiModelProviders,
  LoggedApiModelProviderAbsence,
  type ApiModelProviderCompositionOptions,
} from "./api-model-provider.composition.ts";
import {
  installApiScenario,
  LoggedApiScenarioAbsence,
} from "../features/scenario/scenario.composition.ts";
import { installApiRole } from "../features/role/role.composition.ts";
import { installApiDataRetention } from "../features/data-retention/data-retention.composition.ts";
import {
  installApiMonitor,
  type MonitorWorkflowReplication,
} from "../features/monitor/monitor.composition.ts";
import {
  DeferredPayloadStagingAdapter,
  installApiStoredObject,
  LoggedApiStoredObjectAbsence,
} from "../features/stored-object/stored-object.composition.ts";
import {
  ApiOrganizationSeatLicense,
  installApiOrganization,
  refusingOrganizationFeature,
  type ApiOrganizationInvitePort,
} from "../features/organization/organization.composition.ts";
import {
  installApiProject,
  refusingProjectFeature,
} from "../features/project/project.composition.ts";
import { composeCodingAgentFeature } from "../features/coding-agent/coding-agent.composition.ts";
import { createCodingAgentTrpcRouter } from "../features/coding-agent/coding-agent-trpc.mount.ts";
import { CodingAgentApp } from "@langwatch/coding-agent-server";
import {
  composeAutomationFeature,
  refusingAutomationFeature,
} from "../features/automation/automation.composition.ts";
import {
  composeEnterpriseFeature,
  refusingEnterpriseFeature,
  type ApiEnterpriseApplicationPort,
  type ApiSeatAllowancePort,
} from "../features/enterprise/enterprise.composition.ts";
import { ApiEnterpriseSeatAllowance } from "../features/enterprise/enterprise-seat-allowance.ts";
import {
  ApiTraceReadViewerProtections,
  type ApiViewerProtectionsPort,
} from "../features/trace/trace-viewer-protections.ts";
import {
  composeApiOrganizationInvites,
  type ApiOrganizationInvites,
} from "./api-organization-invites.composition.ts";
import { installApiGateway } from "../features/gateway/gateway.composition.ts";
import { composeEnterpriseGovernanceApplication } from "../features/enterprise/enterprise-governance.composition.ts";
import type { ApiTrpcInfrastructure } from "../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiGatewayIdempotencyPort } from "./api-gateway.composition.ts";
import {
  composeApiIdempotency,
  type ApiIdempotencyComposition,
} from "./api-idempotency.composition.ts";
import {
  ApiGatewaySpendPipelineAbsenceReport,
  composeApiGatewaySpendPipeline,
  type ApiGatewaySpendPipeline,
} from "./api-gateway-spend-pipeline.composition.ts";
import type { GithubApi } from "@langwatch/github-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { EvaluationNameAutoslugService } from "@langwatch/evaluation-server";

import { createPlatformUrlBuilder } from "./api-rest-ports.ts";
import { composeHttpProxyFeature } from "../features/agent/http-proxy.composition.ts";
import type { WorkflowStudioDispatchService } from "@langwatch/workflow-server";
import {
  installApiModelProvider,
  refusingModelProviderFeature,
} from "../features/model-provider/model-provider.composition.ts";
import { installApiDashboard } from "../features/dashboard/dashboard.composition.ts";
import type { HealthProbeRestPorts } from "../features/health/health-probe-rest.mount.ts";
import {
  installApiPlatformHealth,
  type ComposedPlatformHealthFeature,
} from "../features/platform-health/platform-health.composition.ts";
import { installApiEntitlement } from "../features/entitlement/entitlement.composition.ts";
import { refusingAnnotationFeature } from "../features/annotation/annotation-absence.ts";
import { installApiAnnotation } from "../features/annotation/annotation.composition.ts";
import {
  installApiNotification,
  type ComposedNotificationFeature,
} from "../features/notification/notification.composition.ts";
import {
  composeApiTraceProducerCommands,
  type ApiTraceProducerCommands,
} from "../features/trace/trace-producer.composition.ts";
import {
  composeIntegrationsChecksFeature,
  refusingIntegrationsChecksFeature,
  type ApiSimulationEvidencePort,
} from "../features/project/integrations-checks.composition.ts";
import { composeHomeFeature, refusingHomeFeature } from "../features/project/home.composition.ts";
import { PostgresModelProviderEvidenceAdapter } from "@langwatch/model-provider-server";
import type { ComposedHomeFeature } from "../features/project/home.composition.types.ts";
import type { ComposedIntegrationsChecksFeature } from "../features/project/integrations-checks.composition.types.ts";
import { ApiScenarioSimulationEvidence } from "../features/project/scenario-simulation-evidence.ts";
import { TraceSpanIngestPort } from "@langwatch/trace-server";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  ApiTrpcFeaturesComposition,
  LoggedApiTrpcFeaturesAbsence,
} from "./api-trpc-features.composition.ts";
import {
  generateClickHouseFilterConditions,
  LwqlKeyMapClickHouseRepository,
  LwqlKeyMapService,
} from "@langwatch/analytics-server";
import { composeApiWorkflowStudioDispatch } from "./api-studio-host.composition.ts";
import {
  composeApiAuthoringRest,
  LoggedApiAuthoringRestAbsence,
} from "./api-authoring-rest.composition.ts";
import { ApiExperimentRunAbsenceReport } from "./api-experiment-run.composition.ts";
import { composeApiExperimentFindOrCreate } from "../features/experiment/experiment-init-rest.mount.ts";
import { composeApiTraceReadStack } from "./api-trace-read-stack.composition.ts";
import { composeApiEvaluationReads } from "./api-evaluation-read.composition.ts";
import {
  apiEntitlementAbsenceReport,
  composeApiPlanSources,
  composeApiUsageEnforcement,
  composeApiUsageStats,
  type LoggedApiEntitlementAbsence,
} from "./api-usage.composition.ts";
import { tryCreateApiMailComposition, type ApiMailComposition } from "./api-mail.composition.ts";
import { ApiComposedPasswordResetMail } from "./api-better-auth.composition.ts";
import { ApiComposedPersonMail } from "./api-person-mail.composition.ts";
import { ApiAuthzAbsenceReportPort, ApiAuthzComposition } from "./api-authz.composition.ts";
import { ApiTenancyAbsenceReportPort, ApiTenancyComposition } from "./api-tenancy.composition.ts";
import {
  ApiMetricsAbsenceReportPort,
  ApiMetricsInfrastructure,
} from "../platform/infrastructure/api-metrics.infrastructure.ts";
import {
  ApiSecretEncryptionAbsenceReportPort,
  ApiSecretEncryptionInfrastructure,
} from "../platform/infrastructure/api-secret-encryption.infrastructure.ts";
import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main.ts";
import { installApiSecret } from "../features/secret/secret.composition.ts";
import type { ComposedSecretFeature } from "../features/secret/secret.composition.types.ts";
import { ApiRestSecurity, type ApiRestProjectPolicy } from "../api-rest.security.ts";
import type { AppRestManagementAuditPort, RestCredentialPrincipal } from "@langwatch/api/rest";
import { ApiRateLimitInfrastructure } from "../platform/infrastructure/api-rate-limit.infrastructure.ts";
import {
  ApiAuthAbsenceReportPort,
  ApiAuthComposition,
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
  AuthSessionApiAuthenticationAdapter,
} from "./api-auth.composition.ts";
import { createApiUserAvatarObjectReader } from "../features/user/user-avatar-objects.adapter.ts";
import { ApiUserAvatarStorageAdapter } from "../features/user/user-avatar-storage.adapter.ts";
import { ApiInstanceAdminKeyAdapter } from "./api-instance-admin-key.adapter.ts";
import { ApiRestObservabilityComposition } from "./api-rest-observability.composition.ts";
import {
  composeApiBillingWebhook,
  type ApiBillingWebhookComposition,
} from "./api-billing-webhook.composition.ts";
import { ApiHandlerManagedSession } from "./api-handler-managed-session.ts";
import { LoggedApiRestAbsence, openApiRestDoors } from "../app-rest/api-rest.doors.ts";
import { createApiRestRuntime } from "../app-rest/api-rest.runtime.ts";
import type { CronRestPorts } from "../features/cron/cron-rest.ts";
import type { NlpLambdaCleanupService } from "@langwatch/workflow-server";
import { composeNlpLambdaCleanup } from "../features/cron/cron.composition.ts";
import { composeApiPackagedRest } from "./api-packaged-rest.composition.ts";
import {
  composeApiOpsExplainRest,
  type ApiOpsExplainRest,
} from "../features/ops/ops-clickhouse-explain-rest.mount.ts";
import { ApiHandlerManagedCredentials } from "./api-handler-managed-credential.ts";
import { apiClientAddress } from "./api-client-address.ts";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials.ts";
import {
  composeApiTraceIngest,
  LoggedApiTraceIngestAbsence,
} from "./api-trace-ingest.composition.ts";
import { composeApiTraceSpool } from "./api-trace-spool.composition.ts";
import { ApiTraceMediaStore } from "./api-packaged-rest.composition.ts";
import { AdminAccessService, PrismaBugReportRepository } from "@langwatch/ops-server";
import type { BugReportRestPorts } from "../features/bug-report/bug-report-rest.ports.ts";
import type { UnsubscribeRestPorts } from "@langwatch/automation-server";
import { HandledError } from "@langwatch/handled-error";
import {
  SkipPermissionsService,
  LangyLocalControlRuntimeAdapter,
  LangyTokenBufferRedisRepository,
  type LangyConversationCommands,
  LocalControlGateway,
  LocalControlLongPoll,
  LocalControlSessionCoreService,
  type LangyLocalTrpcPorts,
  type LocalControlRuntime,
  type SkipPermissionsProviderRows,
} from "@langwatch/langy-server";
import {
  apiLangyRestMetrics,
  composeApiLangyRest,
  type ApiLangyLocalOptions,
  type ApiLangyRestComposition,
} from "../features/langy/langy-rest.mount.ts";

import { composeApiGithubRest } from "../features/github/github-rest.mount.ts";
import { installApiGithub } from "../features/github/github.composition.ts";
import { composeApiAdminRest } from "../features/ops/admin-rest.mount.ts";
import {
  composeApiAgentPipelines,
  LoggedApiAgentPipelinesAbsence,
  type ApiAgentPipelines,
} from "./api-agent-pipelines.composition.ts";
import { composeLangyFeature, refusingLangyFeature } from "../features/langy/langy.composition.ts";
import { ApiLangyNavigateResourceAdapter } from "../features/langy/langy-navigate-resource.adapter.ts";
import { installApiDataPrivacy } from "../features/data-privacy/data-privacy.composition.ts";
import { installApiOps, LoggedApiOpsAbsence } from "../features/ops/ops.composition.ts";
import { composeApiAuthCliDeviceFlow } from "../features/auth/auth-cli-device-flow-rest.mount.ts";
import { composeApiAuthRest } from "../features/auth/auth-rest.mount.ts";
import { composeApiGovernanceCliRest } from "../features/enterprise/governance-cli-rest.mount.ts";
import { composeApiGovernanceIngestRest } from "../features/enterprise/governance-ingest-rest.mount.ts";
import { installApiScim, LoggedApiScimAbsence } from "./api-scim.composition.ts";
import { composeApiAudit, LoggedApiAuditAbsence } from "./api-audit.composition.ts";
import type { PlatformOperatorPort } from "@langwatch/identity-server";
import {
  HttpWorkflowNlpRuntimeAdapter,
  RedisNlpLambdaArnCacheAdapter,
} from "@langwatch/workflow-server";
import {
  composeApiEnterpriseApplication,
  LoggedApiEnterpriseApplicationAbsence,
} from "./api-enterprise-application.composition.ts";
import type { AuthCliDeviceFlowApi, AuthDoorApi } from "@langwatch/auth-server";
import type {
  GovernanceCliRestPorts,
  GovernanceIngestRestPorts,
  GovernanceIngestTraceCollectionPort,
} from "@langwatch/enterprise-governance-server";
import type { GithubInstallApi } from "@langwatch/github-server";
import type { FilesRateLimiter } from "@langwatch/stored-object-server";
import type { ComposedDatasetFeature } from "../features/dataset/dataset.composition.types.ts";
import type { ComposedEvaluatorFeature } from "../features/evaluator/evaluator.composition.types.ts";
import type { ComposedPromptFeature } from "../features/prompt/prompt.composition.types.ts";
import type { ComposedFeatureFlagFeature } from "../features/feature-flag/feature-flag.composition.types.ts";
import type { ComposedAnalyticsFeature } from "../features/analytics/analytics.composition.types.ts";
import type { ComposedAuthFeature } from "../features/auth/auth.composition.types.ts";
import type { ComposedUserFeature } from "../features/user/user.composition.types.ts";
import type { ComposedPresenceFeature } from "../features/presence/presence.composition.types.ts";
import type { ComposedApiKeyFeature } from "../features/api-key/api-key.composition.types.ts";
import type { ComposedWorkflowFeature } from "../features/workflow/workflow.composition.types.ts";
import type { ComposedExperimentFeature } from "../features/experiment/experiment.composition.types.ts";
import type { ComposedEvaluationFeature } from "../features/evaluation/evaluation.composition.types.ts";
import type { ComposedTraceFeature } from "../features/trace/trace.composition.types.ts";
import type { ComposedShareFeature } from "../features/share/share.composition.types.ts";
import type { ComposedTopicFeature } from "../features/topic/topic.composition.types.ts";
import type { ComposedScenarioFeature } from "../features/scenario/scenario.composition.types.ts";
import type { ComposedRoleFeature } from "../features/role/role.composition.types.ts";
import type { ComposedDataRetentionFeature } from "../features/data-retention/data-retention.composition.types.ts";
import type { ComposedMonitorFeature } from "../features/monitor/monitor.composition.types.ts";
import type { ComposedStoredObjectFeature } from "../features/stored-object/stored-object.composition.types.ts";
import type { ComposedOrganizationFeature } from "../features/organization/organization.composition.types.ts";
import type { ComposedProjectFeature } from "../features/project/project.composition.types.ts";
import type { ComposedCodingAgentFeature } from "../features/coding-agent/coding-agent.composition.types.ts";
import type { ComposedAutomationFeature } from "../features/automation/automation.composition.types.ts";
import type { ComposedEnterpriseFeature } from "../features/enterprise/enterprise.composition.types.ts";
import type { ComposedGatewayFeature } from "../features/gateway/gateway.composition.types.ts";
import type { ComposedHttpProxyFeature } from "../features/agent/http-proxy.composition.types.ts";
import type { ComposedModelProviderFeature } from "../features/model-provider/model-provider.composition.types.ts";
import type { ComposedDashboardFeature } from "../features/dashboard/dashboard.composition.types.ts";
import type { ComposedEntitlementFeature } from "../features/entitlement/entitlement.composition.types.ts";
import type { ComposedAnnotationFeature } from "../features/annotation/annotation.composition.types.ts";
import type { ComposedLangyFeature } from "../features/langy/langy.composition.types.ts";
import type { ComposedDataPrivacyFeature } from "../features/data-privacy/data-privacy.composition.types.ts";
import type { ComposedOpsFeature } from "../features/ops/ops.composition.types.ts";

/**
 * The REST-family capabilities the API process supplies out of its own configuration and its
 * own infrastructure, rather than receiving from a host.
 */
export type ApiOwnedRestFeaturePorts = Readonly<{
  /** The configured instance administrator credential, or undefined when unset. */
  instanceAdminKey: () => string | undefined;
  /** One fixed-window counter, keyed on whatever the caller is identified by. */
  rateLimit: FilesRateLimiter;
}>;

/**
 * What a host hands the production composition, and what it may leave out. One flat object, and
 * every field on it is optional.
 */
export type ApiProductionCompositionOptions = {
  /**
   * A host's already-composed agent service, when it has one.
   */
  agents?: AgentApi;
  /**
   * A host's already-composed API-key service, when it has one.
   */
  apiKeys?: ApiKeyApi;
  /**
   * A host's already-composed AuthZ service, when it has one. Optional since this process can
   * build its own: see {@link ApiProductionComposition.resolveAuthz} for which wins and what an
   * unresolvable AuthZ means for the doors that authorize through it.
   */
  authz?: AuthzService;
  /** A host's already-composed organization service; the pair to `apiKeys`. */
  organizations?: OrganizationService;
  /**
   * A host's already-composed Auth service and Better Auth transport, when it has them as a
   * pair.
   */
  auth?: ApiAuthSessionCompositionPort;
  /**
   * The deployment's Better Auth request boundary, for a host that supplies only that. This is
   * the collaborator the API package cannot build — see {@link ApiAuthComposition} — and the
   * one entry on `API_UNAVAILABLE_PRODUCT_ADAPTERS`.
   */
  browserSessions?: ApiBrowserSessionTransportPort;
  audit?: ApiAuditPort;
  readiness?: ApiReadinessPort;
  /**
   * A host's already-composed metrics transport, when it has one. Optional since this process
   * can build its own: see {@link resolveApiMetrics} for which wins.
   */
  metrics?: ApiMetricsPort;
  featureDrain?: ApiFeatureDrainPort;
  queueStorage?: GroupQueueStoragePort;
  /**
   * A host's already-composed model gateway, when it has one. Optional since this process now
   * composes its own — see {@link ApiProductionComposition.resolveModelProviders} and
   * `api-model-provider.composition.ts` for the six ports and where each is answered from.
   */
  modelProviders?: ModelProviderApi;
  /**
   * The four facts a person-shaped surface needs that are the DEPLOYMENT's: its public host,
   * the sign-in provider it mounted, whether it registered passkeys, and who its operators are.
   */
  identity?: ApiPersonDeploymentFacts;
  /**
   * The messages the identity surfaces send, where the deployment composed a mail gateway. A
   * port rather than the gateway, and for a structural reason: rendering a LangWatch message is
   * react-email, and this process must not pull a React renderer onto its import graph.
   */
  mail?: ApiPersonMailPort;
  /**
   * Whether a project has run any simulation, for the setup checklist.
   */
  simulations?: ApiSimulationEvidencePort;
  /**
   * The ClickHouse trace READ stack, for the five trace surfaces. The largest thing the
   * observability half cannot build: the ten readers the trace application is composed from,
   * plus the redaction and display passes every read is carried through.
   */
  traceReads?: ApiTraceReadStackPort;
  /**
   * The optimization studio's outbound event dispatch, and the agent test's own
   * trace write. Absent, both refuse.
   */
  studioDispatch?: WorkflowStudioDispatchService;
  /**
   * The approaching-limit mail, over the deployment's own gateway. Absent, the
   * send refuses rather than reporting a message it never delivered.
   */
  usage?: UsageWarningPort;
  /** Which plan an organization is on. Absent, the plan read refuses. */
  plans?: PlanProvider;
  /**
   * The invitation service `organization.*` creates, lists, resends, revokes
   * and applies invitations through. Absent, all twelve refuse by name — an
   * empty invite list would tell an administrator nobody had been invited.
   */
  organizationInvites?: ApiOrganizationInvitePort;
  /**
   * The caller's read-time redactions for one project, as `codingAgents.sessionsList` and
   * `project.getFieldRedactionStatus` ask them. The same resolution `traceReads` answers;
   * absent, both refuse rather than guessing what a reader may see.
   */
  viewerProtections?: ApiViewerProtectionsPort;
  /**
   * The Enterprise application the licence, licence-enforcement, SCIM-token, single sign-on and
   * fifteen governance surfaces read.
   */
  enterprise?: ApiEnterpriseApplicationPort;
  /**
   * The receipt ledger the three keyed gateway REST creates dispatch through.
   */
  gatewayIdempotency?: ApiGatewayIdempotencyPort;
};

/** The credential pair every product transport on this process is built from. */
type ApiResolvedTenancy = Readonly<{
  apiKeys: ApiKeyApi;
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

  /**
   * The audit trail this process records on, composed once and held.
   */
  private composedAudit: ApiAuditPort | undefined;
  private composedAuditLog: AuditLogApi | undefined;
  /**
   * The Enterprise application members this process composed over its own graph, or none.
   * An injected application wins — see {@link resolveEnterprise}.
   */
  private composedEnterpriseApplication: ApiEnterpriseApplicationPort | undefined;
  private composedPlatformOperators: PlatformOperatorPort | undefined;
  private composedFeaturePorts: ApiOwnedRestFeaturePorts | undefined;
  private composedDatabase: ApiDatabaseInfrastructure | undefined;
  private composedEventing: ApiEventingInfrastructure | undefined;
  private composedAuthz: ApiAuthzComposition | undefined;
  private composedTenancy: ApiTenancyComposition | undefined;
  private composedAgents: ApiAgentComposition | undefined;
  private agentApi: AgentApi | undefined;
  private evaluatorApi: EvaluatorApi | undefined;
  private agentRelayMaxPayloadMb: number | undefined;
  private readonly agentClients = new LocalFeatureApis();
  private composedConnectedAgents: ApiConnectedAgentsComposition | undefined;
  private composedAuth: ApiAuthComposition | undefined;
  /**
   * The one outbound mail graph this process holds, or none.
   */
  private composedMail: ApiMailComposition | undefined;
  private composedClickHouse: ApiClickHouseInfrastructure | undefined;
  /**
   * The plan allowance both ingest doors refuse an over-plan export with, or none on a process
   * that opened no ClickHouse.
   */
  private composedUsageEnforcement: UsageService | undefined;
  private composedAnalytics!: ComposedAnalyticsFeature;
  /**
   * The rollout store, or none. There is no refusing twin: a process that
   * opened no database installs the feature at all.
   */
  private composedFeatureFlag: ComposedFeatureFlagFeature | undefined;
  /**
   * The flag answer every gate on this process reads, handed out BEFORE the
   * feature is installed. Eventing's kill switch is read by AuthZ, AuthZ by the
   * tenant directories, and those directories are what a tenant-targeted flag
   * read is authorized against — so the reference is what breaks a ring that is
   * otherwise unbreakable. Bound the moment the feature installs, and every
   * call before that refuses by name.
   */
  private composedFeatureFlagApi!: FeatureFlagApi;
  /**
   * The peers a feature installed BEFORE the tenant directories reads through.
   * Its own scope rather than {@link agentClients}: that one is ready when the
   * agent feature installs, and this one when the tenant half has composed.
   */
  private readonly deferredApis = new LocalFeatureApis();
  /**
   * A project's datasets, or none: a process that opened no graph has no rows
   * to read and mounts no dataset family.
   */
  private composedDataset: ComposedDatasetFeature | undefined;
  /**
   * A project's evaluators, or none: a process that opened no graph has no
   * evaluator to publish and mounts no evaluator family.
   */
  private composedEvaluator: ComposedEvaluatorFeature | undefined;
  private composedPrompt!: ComposedPromptFeature;
  private composedAuthFeature!: ComposedAuthFeature;
  private composedUser!: ComposedUserFeature;
  /** The ONE install, memoised: both callers reach the same user graph. */
  private composedUserInstall: Promise<ComposedUserFeature> | undefined;
  private composedPresence!: ComposedPresenceFeature;
  /**
   * The process's ONE tenant fan-out. Created here rather than inside the
   * presence install because four halves ride it and three of them compose
   * before presence can: a second fabric would leave a browser watching a
   * channel nothing writes to.
   */
  private composedBroadcast!: BroadcastAdapter;
  private composedApiKey!: ComposedApiKeyFeature;
  /**
   * The identity ledgers' event stack. Always composed — a process with no queue gets one
   * whose senders are absent, and every write through it refuses BY NAME rather than the
   * whole stack being missing and each caller inventing its own answer.
   */
  private composedIdentityEventing!: ApiEventingIdentityAdapter;
  /**
   * The four things the execution features are built from and hand to each other, held because
   * a feature composed later reads one: the studio graph and its engine, the ONE dataset
   * service, the ONE evaluator service, and the monitor service an experiment upserts through.
   */
  private composedWorkflowRuntime: ApiWorkflowRuntime | undefined;
  private composedDatasets: DatasetApi | undefined;
  private composedEvaluators: EvaluatorApi | undefined;
  private composedWorkflow!: ComposedWorkflowFeature;
  private composedExperiment!: ComposedExperimentFeature;
  /**
   * One trace re-scored, and the pipeline the result is reported on, or none.
   * There is no refusing twin: a process that opened no graph has nothing to
   * re-score and nowhere to report a score to.
   */
  private composedEvaluation: ComposedEvaluationFeature | undefined;
  private composedTrace!: ComposedTraceFeature;
  /** The seat gate `licenseEnforcement.*` answers from; see {@link optionalPorts}. */
  private composedSeatAllowances: ApiSeatAllowancePort | undefined;
  /**
   * The share ledger, or none. There is no refusing twin: a process that opened
   * no database mounts neither share namespace.
   */
  private composedShare: ComposedShareFeature | undefined;
  /**
   * The topic tree a project's traces are labelled by, or none. There is no
   * refusing twin: a process that opened no database has no tree to label from.
   */
  private composedTopic: ComposedTopicFeature | undefined;
  /**
   * The organization's custom roles and their bindings, or none. There is no
   * refusing twin: `ctx.app.roles` is read by the invitation half as well, so
   * the record refuses whole rather than offering a role surface with no
   * ledger behind it.
   */
  private composedRole: ComposedRoleFeature | undefined;
  private composedHome!: ComposedHomeFeature;

  /**
   * How long a project's scopes keep what they captured, or none. There is no
   * refusing twin: a process with no database bounds nothing.
   */
  private composedDataRetention: ComposedDataRetentionFeature | undefined;
  /**
   * The monitor surface, or none: a process that composed no graph has no
   * evaluator for a monitor to run, and mounts no monitor family.
   */
  private composedMonitor: ComposedMonitorFeature | undefined;
  private composedStoredObject!: ComposedStoredObjectFeature;
  /**
   * The operator's Azure spool assertion, read once with the rest of the
   * config and held here because the door that composes the spool is built
   * from the resolved graph rather than from the configuration.
   */
  private azureSpoolRetentionConfirmed = false;
  /**
   * A project's scoped privacy rules, or none. There is no refusing twin: a
   * process that opened no database resolves no policy.
   */
  private composedDataPrivacy: ComposedDataPrivacyFeature | undefined;
  private composedIntegrationsChecks!: ComposedIntegrationsChecksFeature;
  private composedAnnotation!: ComposedAnnotationFeature;
  private composedNotification: ComposedNotificationFeature | undefined;
  /**
   * A project's dashboards, the graphs on them, the saved charts they place and
   * the explorer's stored filter sets, or none. There is no refusing twin: a
   * process that opened no database has no dashboard to place a card on.
   */
  private composedDashboard: ComposedDashboardFeature | undefined;
  /**
   * The monitoring-keyed report on this deployment's own subsystems, or none.
   * None without both monitoring secrets: a report nobody can be told apart
   * from anyone else is not a report.
   */
  private composedPlatformHealth: ComposedPlatformHealthFeature | undefined;
  private composedEntitlement: ComposedEntitlementFeature | undefined;
  private composedHttpProxy!: ComposedHttpProxyFeature;
  private composedStudioDispatch: WorkflowStudioDispatchService | undefined;
  private composedModelProvider!: ComposedModelProviderFeature;
  /**
   * The trace-side senders this process registered, once. Held on the composition because three
   * surfaces write on the one registration: a reviewer's comment marker, the reserved-metadata
   * amendment's span, and the agent test's own trace write.
   */
  private composedTraceCommands!: ApiTraceProducerCommands;
  private composedScenario!: ComposedScenarioFeature;
  private composedOrganization!: ComposedOrganizationFeature;
  private composedProject!: ComposedProjectFeature;
  private composedCodingAgent!: ComposedCodingAgentFeature;
  private composedAutomation!: ComposedAutomationFeature;
  private composedEnterprise!: ComposedEnterpriseFeature;
  /**
   * The directory-sync application, where this process composed one. Read by
   * the three SCIM REST families, by the `scimToken` namespace and by the SCIM
   * door's own bearer verification — one object, so the four cannot disagree.
   */
  private composedScim: ScimApi | undefined;
  /**
   * The process's ONE invitation service, or none. Held rather than composed per door because
   * both doors administer the same invitations: `organization.*` creates and lists them over
   * tRPC, and `/api/organization/{id}/invites` does the same over the management REST family.
   */
  private composedOrganizationInvites: ApiOrganizationInvites | undefined;
  private resolvedOrganizationInvites = false;
  private composedGateway!: ComposedGatewayFeature;
  private composedOps!: ComposedOpsFeature;
  private composedLangy!: ComposedLangyFeature;
  private composedAgentPipelines!: ApiAgentPipelines;
  /**
   * The process's ONE `Idempotency-Key` receipt ledger, or none. Held rather than rebuilt per
   * door because the claim protocol only works when every keyed create on this process shares
   * one takeover clock.
   */
  private composedIdempotency: ApiIdempotencyComposition | undefined;
  /**
   * The process's ONE producer registration of the gateway-spend pipeline, or none.
   */
  private composedGatewaySpendPipeline: ApiGatewaySpendPipeline | undefined;
  /**
   * The payment provider's callback and the write path behind it. Always
   * composed, never conditional: the route is mounted on every deployment and
   * answers 404 where nothing bills, exactly as it always has.
   */
  private composedBillingWebhook!: ApiBillingWebhookComposition;
  /**
   * The stored-secret cipher this process composed, or none.
   */
  private composedEncryption: SecretEncryptionPort | undefined;
  private composedGithub: GithubApi | undefined;
  private composedModelProviders: ModelProviderApi | undefined;
  /** The gateway's options, kept so the module install reads the same list. */
  private modelProviderOptions: ApiModelProviderCompositionOptions | undefined;
  private composedPlanProvider: PlanProvider | undefined;
  private composedPlanSources: EntitlementServiceOptions | undefined;
  private composedEntitlementAbsence: LoggedApiEntitlementAbsence | undefined;
  /**
   * The one shared counter.
   */
  private readonly rateLimiter = ApiRateLimitInfrastructure.create({
    connection: () => this.composedQueueRedis,
  });

  private composedQueueRedis: RedisConnection | undefined;
  /**
   * The process's ONE evaluator runtime, resolved on first use.
   */
  private composedEvaluatorExecution: ApiEvaluatorExecution | undefined;
  private resolvedEvaluatorExecution = false;
  /**
   * Where `LANGEVALS_ENDPOINT` was read, and this process's own name, held for
   * the lazy composition above: it runs at a call, long after `compose` was
   * handed the configuration.
   */
  private evaluatorLangevalsEndpoint: string | undefined;
  private evaluatorProcessName = "langwatch-api";
  /**
   * The shared bearer the Langy agent presents on its callbacks, held from
   * `compose` because the doors that read it are built by {@link composeDoors},
   * which is handed a request policy rather than a configuration.
   */
  private composedLangyInternalSecret: string | undefined;
  private composedLangyLocalRuntime: LocalControlRuntime | undefined;
  private composedLangyPublicBaseUrl: string | undefined;
  private composedLangyLocalSessionCore: LocalControlSessionCoreService | undefined;
  private composedLangyLocalLongPoll: LocalControlLongPoll | undefined;
  /** The shared bearer the internal cron family authenticates its caller with, or none. */
  private composedCronApiKey: string | undefined;
  /** The studio-Lambda sweep the destructive cron route runs, where one is configured. */
  private composedNlpLambdaCleanup: NlpLambdaCleanupService | undefined;
  /**
   * Whether this deployment is the hosted product, held from `compose` for the
   * same reason the Langy secret is: the instance-provisioning family reads it
   * and {@link composeDoors} is handed services rather than a configuration.
   */
  private composedIsSaas = false;
  /**
   * The two facts the retired route file's own doors read straight off the environment: which
   * project is the globally-readable demo, and how far this deployment lets an outbound fetch
   * reach.
   */
  private composedRestEnvironment: Readonly<{
    demoProjectId: string | undefined;
    blockLocalHttpCalls: boolean;
    allowedProxyHosts: readonly string[];
  }> = { demoProjectId: undefined, blockLocalHttpCalls: true, allowedProxyHosts: [] };
  /**
   * The two directory-sync switches, held for the same reason the two above are: {@link
   * composeDoors} is handed services rather than a configuration.
   */
  private composedScimEnvironment: Readonly<{
    auth0WebhookSecret: string | undefined;
    provenOffboarding: boolean;
  }> = { auth0WebhookSecret: undefined, provenOffboarding: false };
  /**
   * The operator-only ClickHouse EXPLAIN family, where this deployment provisioned the
   * dedicated readonly account it runs as.
   */
  private composedOpsExplain: ApiOpsExplainRest | undefined;
  /**
   * The one evaluator-id slug rule on this process.
   */
  private readonly evaluatorIdSlug = EvaluationNameAutoslugService.create();
  /**
   * The project's stored credentials, or none. There is no refusing twin: a
   * process holding no cipher installs neither the namespace nor the two REST
   * families, rather than serving doors over a store it cannot decrypt.
   */
  private composedSecret: ComposedSecretFeature | undefined;
  /**
   * The process's ONE project-credential door. Created here rather than inside
   * `composeDoors` because the secret families authenticate through it and they
   * install before that method runs.
   */
  private composedHandlerCredentials!: ApiHandlerManagedCredentials;
  private requestPolicy: ApiRequestPolicy | undefined;

  private constructor(private readonly options: ApiProductionCompositionOptions) {
    super();
  }

  /**
   * Composes the process, in the one order its parts allow. Infrastructure first, because every
   * product service below is built from it; then AuthZ, because both doors authorize through it
   * and neither can be built before it exists; then the transports.
   */
  async compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const queueInfrastructure = this.composeQueue(options);
    this.composedDatabase = composeApiDatabase(options);
    // Booted whether or not a host injected its own trail: the operator and
    // evaluator surfaces record and read through this token, not through the
    // request policy's.
    if (this.composedDatabase) {
      const auditLog = await EnterpriseApiAuditLog.create({
        prisma: this.composedDatabase.connection.client,
      });
      options.resources.own("audit-log", () => auditLog.stop());
      this.composedAuditLog = auditLog.auditLog();
    }
    // The process's ONE flag answer, handed out here and installed further
    // down. Eventing's kill switch reads it, AuthZ is composed over Eventing,
    // the tenant directories over AuthZ — and a tenant-targeted flag read is
    // authorized against those same directories. The reference is what lets
    // that ring compose in one order instead of none.
    this.deferredApis.declare(FeatureFlagApi);
    this.deferredApis.declare(ProjectApi);
    this.deferredApis.declare(OrganizationApi);
    this.composedFeatureFlagApi = this.deferredApis.reference(FeatureFlagApi);
    this.composedEventing = this.composeEventing(options, queueInfrastructure);
    // The four identity definitions, registered PRODUCER-only on this process's own
    // Eventing. Before the Auth graph rather than beside the person-shaped features,
    // because Better Auth's storage and its three account ceremonies stage through them
    // too: composed after, the deployment's own transport would be built over an event
    // stack that did not exist yet and would run the legacy branch forever.
    this.composedIdentityEventing = ApiEventingIdentityAdapter.create({
      pipelines: composeApiIdentityPipelines({
        eventing: this.composedEventing?.eventSourcing,
        processName: options.config.serviceName,
        report: LoggedApiIdentityPipelinesAbsence.create(createLogger(options.config.serviceName)),
      }),
    });
    const authz = this.resolveAuthz(options, queueInfrastructure);
    const readiness = this.options.readiness ?? queueInfrastructure?.readiness;
    const metrics = resolveApiMetrics({ options, injected: this.options.metrics });
    const encryption = composeApiSecretEncryption(options)?.encryption;
    this.composedEncryption = encryption;
    this.resolveClickHouse(options);
    const tenancy = authz ? await this.resolveTenancy(options, encryption) : undefined;
    // Before the Auth graph, because the password-reset link leaves through it
    // and that graph is where Better Auth is composed. Nothing downstream of a
    // session gate: a deployment that cannot verify a browser caller still has
    // a gateway, it simply mounts no door that would use one.
    this.composedMail = tryCreateApiMailComposition({
      config: options.config,
      resources: options.resources,
    });
    const auth = tenancy
      ? await this.resolveAuth(options, tenancy, queueInfrastructure)
      : undefined;

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

    // The process's ONE project-credential door, resolved before the two
    // secret REST families that authenticate through it: a key refused at the
    // packaged families cannot be accepted at `/api/secret`.
    this.composedHandlerCredentials = ApiHandlerManagedCredentials.create({
      apiKeys: tenancy.apiKeys,
      authz,
      organizations: tenancy.organizations,
    });
    // The deployment's rollout flags, over the three directories a
    // tenant-targeted read is authorized against. Installed here, and the
    // reference handed out above is bound to it: everything that gates on a
    // flag composed before this line reads THIS application.
    const flagDatabase = this.composedDatabase?.connection;
    this.composedFeatureFlag =
      flagDatabase && this.composedAuthz
        ? await installApiFeatureFlag({
            prisma: flagDatabase.client,
            config: options.config.featureFlags,
            peers: {
              permissions: this.composedAuthz.app,
              projects: this.deferredApis.reference(ProjectApi),
              organizations: this.deferredApis.reference(OrganizationApi),
            },
          })
        : undefined;
    if (this.composedFeatureFlag) {
      this.deferredApis.bind(FeatureFlagApi, this.composedFeatureFlag.app);
    }
    this.composedSecret = await this.resolveSecretApp(encryption);
    this.composedIsSaas = options.config.infrastructure.modelProvider.isSaas;
    this.composedRestEnvironment = {
      demoProjectId: options.config.authz.demoProjectId,
      blockLocalHttpCalls: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
      allowedProxyHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
    };
    this.composedScimEnvironment = {
      auth0WebhookSecret: options.config.scim.auth0WebhookSecret,
      provenOffboarding: options.config.scim.provenOffboarding,
    };
    // Held rather than read at the call: this process's configuration is read
    // once, here, and the evaluator runtime is composed lazily further down.
    this.evaluatorLangevalsEndpoint = options.config.infrastructure.execution.langevalsEndpoint;
    this.evaluatorProcessName = options.config.serviceName;
    // The operator EXPLAIN endpoint's own connection. Separate from
    // `ApiClickHouseInfrastructure` on purpose: that one is tenant-keyed and
    // hands out no shared client, and this endpoint is cross-tenant by design.
    this.composedOpsExplain = composeApiOpsExplainRest({
      opsClickHouseUrl: options.config.infrastructure.clickhouse.opsUrl,
      opsApiKey: options.config.opsApiKey,
      isProduction: options.config.nodeEnvironment === "production",
    });
    if (this.composedOpsExplain) {
      options.resources?.own("api ops clickhouse explain client", () =>
        this.composedOpsExplain!.close(),
      );
    }
    this.composedFeaturePorts = this.composeFeaturePorts(options, queueInfrastructure);
    this.requestPolicy = ApiRequestPolicy.create({
      authentication: AuthSessionApiAuthenticationAdapter.create(auth.compose()),
      authorization: AuthzApiAuthorizationAdapter.create(authz),
      audit: this.resolveAudit(),
    });
    const agents = this.allocateAgent(options);
    const database = this.composedDatabase?.connection;
    const infrastructure = database
      ? {
          prisma: database.client,
          authz,
          // The SAME plan provider every allowance banner reads, and the SAME
          // flag store `featureFlag.*` answers from. Both are the process's,
          // not any one feature's, so a gate and the surface beside it cannot
          // disagree.
          plans: this.resolvePlanProvider(options),
          featureFlags: this.composedFeatureFlagApi,
          // One variable, one meaning: `IS_SAAS` is what decides whether this
          // installation bills through Stripe, read from the one leaf that
          // already carries it rather than from a second of its own.
          saasBilling: options.config.infrastructure.modelProvider.isSaas,
          audit: this.resolveAudit(),
          auditLog: this.resolveAuditLog(),
        }
      : undefined;
    // A project's scoped privacy rules, composed HERE because the charted reads
    // redact by the SAME resolved policy the trace read stack does: a chart and
    // the traces behind it must not disagree about which fields a project keeps.
    this.composedDataPrivacy =
      infrastructure && this.composedAuthz
        ? await installApiDataPrivacy({
            infrastructure,
            peers: {
              // The two directories are referenced rather than passed: the
              // tenant half installs them below, and a privacy read only ever
              // resolves a scope once a request is in flight.
              projects: this.deferredApis.reference(ProjectApi),
              organizations: this.deferredApis.reference(OrganizationApi),
              // The SAME permission answers the declared check on the same
              // procedure asks; a second AuthZ here would be a second answer.
              permissions: this.composedAuthz.app,
            },
          })
        : undefined;
    this.composedAnalytics = this.composeAnalytics(options, authz);
    // The person half of the same record: the two signed-out doors, the signed-in person's
    // account and credentials, their organization's membership and groups, join requests,
    // sign-up and presence. Composed over the SAME user directory the browser-session boundary
    // resolves through and the SAME organization service the REST doors serve from — a second
    // of either would be a second answer to who somebody is.
    await this.composePersonFeatures(options, tenancy);
    // The product half: a reviewer's annotations, the support inbox, the project's privacy
    // rules and its setup checklist. It composes FIRST because it is the one half that cannot
    // be missing on a process holding a database, which is what makes it the seed the other
    // three fold onto. The trace-side senders, registered once and handed to everything that
    // writes on the lane.
    this.composedTraceCommands = composeApiTraceProducerCommands({
      eventing: this.composedEventing?.eventSourcing,
      processName: options.config.serviceName,
    });
    // The tenant fan-out every live surface on this process rides: presence,
    // both trace subscriptions, the simulation feed, the workbench cell and the
    // two bulk exports. Created HERE because it is the process's rather than
    // any one feature's, and before the four halves that take it. Over the SAME
    // Redis the queue owns, so a replica publishes where the others subscribe.
    this.composedBroadcast = BroadcastAdapter.create(queueInfrastructure?.redis ?? null);
    options.resources.own("api presence broadcast", () => this.composedBroadcast.close());
    options.resources.ownService({
      name: "api presence broadcast",
      start: () => this.composedBroadcast.start(),
      stop: () => this.composedBroadcast.close(),
    });
    // The execution features: the studio's own lifecycle, the optimization
    // panel, the experiment wizard and its run loop, and the re-score. One
    // workflow service serves all of them plus the evaluator service built
    // over it, and the re-score reports through a PRODUCER-only registration
    // of the same pipeline the worker drains.
    await this.composeExecutionFeatures(
      options,
      agents,
      encryption,
      tenancy,
      queueInfrastructure,
      infrastructure,
    );
    // The three services the trace application is built over, each composed by
    // the feature that owns it: the retention window a read's floor is widened
    // to, the ledger an anonymous read redeems its token against, and the tree
    // the grid labels its rows from. A second of any of them would be a second
    // answer to one question.
    this.composedDataRetention = infrastructure
      ? await this.composeDataRetention(options, infrastructure, queueInfrastructure)
      : undefined;
    this.composedTopic = infrastructure ? await installApiTopic({ infrastructure }) : undefined;
    const retention = this.composedDataRetention;
    this.composedShare =
      infrastructure && this.composedTenancy && this.composedAuthz && retention
        ? await installApiShare({
            infrastructure,
            peers: {
              projects: this.composedTenancy.projects,
              dataRetention: retention.service,
              permissions: this.composedAuthz.app,
            },
            // The SAME Redis the queue owns, which presence and the broadcast
            // fan-out already ride.
            redis: queueInfrastructure?.redis ?? null,
          })
        : undefined;
    // A project's captured traffic: the trace itself and the five surfaces it
    // is read and corrected through. It composes after those three because it
    // reads all of them, and after the analytics half because its ClickHouse is
    // the one that opened there.
    this.composedTrace = this.composeTrace(options, authz, encryption);
    // One trace re-scored, and the pipeline every re-score reports on. HERE
    // because it stands on the trace read stack and the retention cascade its
    // reads are floored by, and both open on the two lines above.
    this.composedEvaluation = await this.installEvaluation(options, infrastructure, retention);
    // The monthly allowance the two ingest doors enforce, composed HERE because this is the
    // first line at which everything it stands on is open: the guarded client, the ClickHouse
    // the analytics half opened, and the one plan provider the trace group just resolved.
    // Absent on a process with no database or no ClickHouse — an allowance nothing can count
    // against is not enforcement — and the doors name that absence themselves.
    this.composedUsageEnforcement = this.composedDatabase
      ? composeApiUsageEnforcement({
          prisma: this.composedDatabase.connection.client,
          plans: this.resolvePlanProvider(options),
          clickhouse: this.composedClickHouse
            ? {
                resolveClient: this.composedClickHouse.resolveClient,
                resolveOrganizationClient: this.composedClickHouse.resolveOrganizationClient,
              }
            : null,
          isSaas: options.config.infrastructure.modelProvider.isSaas,
          ...(options.config.infrastructure.execution.publicBaseUrl
            ? { baseHost: options.config.infrastructure.execution.publicBaseUrl }
            : {}),
        })
      : undefined;
    // The agent half: the test cases and conversations an agent is written, watched and driven
    // through. It composes LAST because it reads what every other half opened — this process's
    // ClickHouse, the queue's Redis, the broadcast fabric presence publishes on, and the agent,
    // user and project directories the tenancy and identity halves built. The three agent-side
    // pipelines, registered PRODUCER-only on this process's own Eventing.
    this.composedAgentPipelines = composeApiAgentPipelines({
      eventing: this.composedEventing?.eventSourcing,
      processName: options.config.serviceName,
      report: LoggedApiAgentPipelinesAbsence.create(createLogger(options.config.serviceName)),
    });
    this.composedScenario = await this.composeScenario(
      options,
      authz,
      queueInfrastructure,
      encryption,
    );
    // The roles a member is granted and the strip of what they last opened.
    // Both used to ride inside the product-group half, so a process missing any
    // one of its six collaborators lost every role surface with it.
    this.composedRole =
      infrastructure && this.composedAuthz
        ? await installApiRole({
            infrastructure,
            peers: {
              // The SAME permission answers the declared check on the same
              // procedure asks; a second AuthZ here would be a second answer.
              permissions: this.composedAuthz.app,
              // The tenant directory the process binds once the tenant half
              // has composed: this feature installs BEFORE it, because the
              // invitation half reads assignability through the roles below.
              organizations: this.deferredApis.reference(OrganizationApi),
              users: this.composedUser.app,
            },
            // The SAME plan provider every allowance banner reads: a
            // capability refused here and offered there would be one
            // organization on two plans.
            plans: this.resolvePlanProvider(options),
          })
        : undefined;
    this.composedHome = infrastructure
      ? composeHomeFeature({ infrastructure })
      : refusingHomeFeature();
    // The invitation half, composed here rather than inside the org-group half because BOTH
    // doors need it: `organization.*` administers invitations over tRPC and
    // `/api/organization/{id}/invites` over REST, and the REST doors are composed further down.
    // Everything it stands on — the grant ledger, the role service, the plan provider and this
    // process's connection — is open by this line.
    this.resolveOrganizationInvites(options);
    // The org-group half: the nine surfaces a TENANT is administered through — its members and
    // their bindings, its projects' own lifecycle, the coding agents inside them, the
    // automations they fire, and the four Enterprise namespaces. It folds on rather than
    // seeding, because every one of them resolves an organization or a project through the
    // tenancy graph.
    await this.composeTenantFeatures(options, encryption, queueInfrastructure, infrastructure);
    // The two tenant directories the rollout gate and the retention surface
    // authorize a tenant-targeted read against, bound now that the half that
    // owns them has composed. Both features installed above hold references to
    // these, and every call through one before this line refuses by name.
    if (this.composedFeatureFlag) {
      this.deferredApis.bind(ProjectApi, this.composedProject.app);
      this.deferredApis.bind(OrganizationApi, this.composedOrganization.app);
      this.deferredApis.ready();
      options.resources.own("api deferred feature apis", () => this.deferredApis.close());
    }
    // Who else is looking at this project. Installed HERE because this is the
    // first line at which the project directory it resolves a project's
    // presence policy through is open, over the fan-out the process created
    // above and the halves before it already publish on.
    this.composedPresence = await installApiPresence({
      broadcast: this.composedBroadcast,
      // The SAME Redis the queue owns: a session is kept where the fan-out
      // rides rather than on a second connection.
      redis: queueInfrastructure?.redis ?? null,
      peers: { projects: this.composedProject.app, users: this.composedUser.app },
    });
    // A project's own object store and the monitors running beside it. They compose after the
    // execution and product-group halves because the monitor surface takes their monitor
    // service, evaluator service and evaluator replication — one graph per answer, rather than
    // a second one that could disagree.
    this.composedStoredObject = await this.installStoredObject(options);
    this.azureSpoolRetentionConfirmed =
      options.config.infrastructure.storedObjects.azureSpoolRetentionConfirmed;
    // The `Idempotency-Key` receipt ledger, over the SAME database every keyed
    // create writes its resource to and the SAME cipher every other at-rest
    // secret is written under. Composed before the gateway because its three
    // keyed REST creates dispatch through it.
    this.composedIdempotency = composeApiIdempotency({
      database: this.composedDatabase?.connection.client,
      encryption,
    });
    // The AI Gateway, composed HERE rather than inside the record: its application is read by
    // `ctx.app`, by the two public REST families and by the six tRPC namespaces, so the process
    // composes it once and hands each door the part it needs. It composes LAST of the product
    // graph because its peers are what the execution half opened.
    const directory = this.composedTenancy;
    const github =
      database && directory
        ? await this.resolveGithub(options, database.client, queueInfrastructure, directory)
        : undefined;
    this.composedGateway = await this.composeGateway(options, infrastructure);
    // The back office, composed from the shared infrastructure plus the three other features it
    // names: the people a row is about, the session an impersonation is started against, and
    // the projects a scheduled job is scoped to. It used to ride inside the agent half, which
    // cost every operator surface whenever a scenario collaborator was missing. A project's
    // datasets, its evaluators and its prompt library.
    const promptPermissions = this.composedAuthz?.app;
    if (!infrastructure || !directory || !promptPermissions) {
      throw new Error(
        "api prompt composition needs infrastructure, a directory and authorization: this process installed none",
      );
    }
    this.composedPrompt = await installApiPrompt({
      infrastructure,
      peers: {
        projects: directory.projects,
        permissions: promptPermissions,
        ...(this.composedModelProviders ? { modelProviders: this.composedModelProviders } : {}),
      },
    });
    this.composedOps = await this.composeOps(options, infrastructure, directory);
    // The setup checklist. Its provider step is answered by the model-provider feature's OWN
    // persistence rather than by a `prisma.modelProvider` read written in the checklist: the
    // question is one existence read over the project's scope cascade, and that table holds
    // every stored credential in the deployment.
    // Directory sync, over the SAME grant ledger every other membership change
    // is recorded on. HERE because its gate is the Enterprise governance
    // application the tenant half just opened.
    this.composedScim = await this.installScim(options.config.serviceName);
    // A reviewer's comments, scores and queues.
    this.composedAnnotation = await this.installAnnotation(infrastructure);
    // A project's dashboards, the graphs on them, the saved workbench charts
    // they place and the explorer's stored filter sets. It installs HERE
    // because it stands on three peers already open: the charted reads a saved
    // statement runs through, the alert automations a card's bell renders, and
    // the project directory a dashboard's own address is built from.
    this.composedDashboard = infrastructure
      ? await installApiDashboard({
          infrastructure,
          peers: {
            analytics: this.composedAnalytics.analytics,
            automation: this.composedAutomation.app,
            projects: this.composedProject.app,
          },
          ports: {
            ...this.composedAnalytics.dashboardPorts,
            // Empty, exactly as the graph ports this replaces answered: this
            // process composes no redaction for a card's alert parameters, so
            // none of a provider's stored secrets leaves the server.
            redactActionParams: () => ({}),
            platformUrl: createPlatformUrlBuilder(
              options.config.infrastructure.execution.publicBaseUrl,
            ),
          },
        })
      : undefined;
    // The deployment's own liveness report, over the SAME five probes the
    // project-keyed `/api/health/*` family answers from: two doors, one answer
    // to what a subsystem's health is. Absent without both monitoring secrets.
    this.composedPlatformHealth = await installApiPlatformHealth({
      apiKey: options.config.platformHealth.apiKey,
      probeApiKey: options.config.platformHealth.probeApiKey,
      probes: this.composeHealthProbes({
        publicBaseUrl: options.config.infrastructure.execution.publicBaseUrl,
        apiKeys: tenancy.apiKeys,
      }),
    });
    // The durable notification record the approaching-limit warning writes,
    // so the next reading knows this organization was already told.
    this.composedNotification = infrastructure
      ? await installApiNotification({ infrastructure })
      : undefined;
    this.composedEntitlement = await this.composeEntitlement(options, infrastructure);
    // The studio's dispatch and the provider surfaces. Both used to ride inside
    // the observability half, so a process missing the trace read stack lost
    // the studio and every stored credential with it. The provider feature
    // takes the trace stack's OWN span reader as a peer, because a cost rule's
    // preview matches against the spans the explorer reads.
    this.composedHttpProxy = composeHttpProxyFeature();
    await this.installAgent(options);
    this.composedConnectedAgents = ApiConnectedAgentsComposition.create({
      agents,
      relayMaxPayloadMb: options.config.infrastructure.connectedAgents.relayMaxPayloadMb,
    });
    // Installed over the same options the gateway was composed from; a process
    // that composed no gateway holds no cipher, and its surfaces refuse by name.
    this.composedModelProvider = this.modelProviderOptions
      ? await installApiModelProvider({
          ...this.modelProviderOptions,
          peers: this.composedTrace.traceReads
            ? { spans: this.composedTrace.traceReads.readers().spans }
            : {},
        })
      : refusingModelProviderFeature();
    const simulationEvidence = this.resolveSimulationEvidence();
    this.composedIntegrationsChecks =
      infrastructure && directory
        ? composeIntegrationsChecksFeature({
            infrastructure,
            modelProviders: PostgresModelProviderEvidenceAdapter.create({
              database: infrastructure.prisma,
              projects: directory.projects,
            }).build(),
            // Whether this project has run a simulation, off the SAME
            // simulation service the scenario surfaces read.
            ...(simulationEvidence ? { simulations: simulationEvidence } : {}),
          })
        : refusingIntegrationsChecksFeature();
    // The conversation panel and the egress allow-list beside it. It used to
    // ride inside the agent half, so a process missing any scenario
    // collaborator lost both Langy surfaces with it.
    this.composedLangy = this.composeLangy(options, infrastructure, directory, queueInfrastructure);
    // The payment provider, composed HERE rather than beside the other REST
    // families: `subscription.*` reads the same checkout and customer services
    // off `ctx.app` that the webhook writes through, and this literal is where
    // that application is assembled. The door itself is opened later, from the
    // same composition, once the process's credential resolution exists.
    this.composedBillingWebhook = composeApiBillingWebhook({
      billing: options.config.billing,
      prisma: this.composedDatabase?.connection.client,
      // The organization object the provisioning door writes through, which is
      // the one that declares the two billing reads: the `ctx.app` slice
      // deliberately narrows them away.
      organizations: this.composedOrganization.provisioning,
      // The SAME retention cascade `/settings/data-retention` writes, so a
      // first paid seat subscription's default and an operator's override are
      // one set of rules rather than two.
      dataRetention: this.composedDataRetention?.service,
      ...(this.composedMail ? { mail: this.composedMail } : {}),
    });
    // Single sign-on, booted over this deployment's own ledger and licence.
    // HERE because it stands on four peers the halves above opened: the licence
    // surfaces, the ADMIN_EMAILS staff list, the user directory the staff list
    // resolves an address through, and the audit trail every back-office
    // command is recorded on before it runs.
    const sso = await this.composeSso(options);
    if (sso) options.resources.own("api single sign-on", () => sso.stop());
    // The eleven features with no refusing twin. None mounts without its own
    // application - `ctx.app.share`, `ctx.app.secrets`, `ctx.app.topics`,
    // `ctx.app.sso`, `ctx.app.dashboard`, `ctx.app.evaluations`, the resolved
    // privacy policy, the retention window and the one plan answer are all read
    // by surfaces those features do not own - so the record refuses whole
    // rather than serving slices with nothing behind.
    const share = this.composedShare;
    const entitlement = this.composedEntitlement;
    const dataRetention = this.composedDataRetention;
    const featureFlag = this.composedFeatureFlag;
    const secret = this.composedSecret;
    const topic = this.composedTopic;
    const dataPrivacy = this.composedDataPrivacy;
    const dashboard = this.composedDashboard;
    const evaluation = this.composedEvaluation;
    const role = this.composedRole;
    // The caller's own grants, as `authz.*` reports them back. The same
    // application every declared check on this root already runs on.
    const permissions = this.composedAuthz?.app;
    const trpcAbsence = LoggedApiTrpcFeaturesAbsence.create(
      createLogger(options.config.serviceName),
    );
    if (
      infrastructure &&
      (!share ||
        !entitlement ||
        !dataRetention ||
        !featureFlag ||
        !secret ||
        !topic ||
        !dataPrivacy ||
        !dashboard ||
        !evaluation ||
        !role ||
        !permissions ||
        !sso)
    ) {
      trpcAbsence.absent("no-collaborators");
    }
    const features =
      share &&
      entitlement &&
      dataRetention &&
      featureFlag &&
      secret &&
      topic &&
      dataPrivacy &&
      dashboard &&
      evaluation &&
      role &&
      permissions &&
      sso
        ? ApiTrpcFeaturesComposition.tryCompose({
            // What a feature composes ITSELF out of, built once above and handed to
            // every `compose<Feature>()` the record's literal names.
            infrastructure,
            // The features whose doors are not only tRPC, composed before the mount
            // existed. Absent infrastructure there is no record either, so the
            // refusing gateway stands in rather than a second condition here.
            composed: {
              analytics: this.composedAnalytics,
              featureFlag,
              dataset: this.composedDataset,
              evaluator: this.composedEvaluator,
              prompt: this.composedPrompt,
              gateway: this.composedGateway,
              langy: this.composedLangy,
              ops: this.composedOps,
              scenario: this.composedScenario,
              dataRetention,
              home: this.composedHome,
              role,
              monitor: this.composedMonitor,
              storedObject: this.composedStoredObject,
              dataPrivacy,
              integrationsChecks: this.composedIntegrationsChecks,
              annotation: this.composedAnnotation,
              dashboard,
              entitlement,
              httpProxy: this.composedHttpProxy,
              modelProvider: this.composedModelProvider,
              share,
              topic,
              trace: this.composedTrace,
              workflow: this.composedWorkflow,
              experiment: this.composedExperiment,
              evaluation,
              organization: this.composedOrganization,
              project: this.composedProject,
              codingAgent: this.composedCodingAgent,
              automation: this.composedAutomation,
              enterprise: this.composedEnterprise,
              auth: this.composedAuthFeature,
              user: this.composedUser,
              presence: this.composedPresence,
              apiKey: this.composedApiKey,
              secret,
            },
            // The ONE application every packaged surface reads off `ctx.app`. One
            // literal, and every slice on it is contributed by the feature that
            // composed it, or by that feature's named refusal.
            collaborators: {
              application: {
                apiKeys: this.composedApiKey.app,
                broadcast: this.composedPresence.emitter,
                config: this.composedUser.config,
                organizations: this.composedOrganization.app,
                presence: this.composedPresence.app,
                users: this.composedUser.app,
                analytics: this.composedAnalytics.analytics,
                annotation: this.composedAnnotation.app,
                modelProviders: this.composedModelProvider.app,
                dataRetention: dataRetention.service,
                // The booted entitlement application, which resolves the plan off
                // the SAME sources this process's own provider does.
                planProvider: entitlement.app,
                secrets: secret.app,
                share: share.app,
                topics: topic.app,
                dataPrivacy: dataPrivacy.app,
                sso: sso.sso(),
                traces: this.composedTrace.traces,
                workflows: this.composedWorkflow.app,
                experiments: this.composedExperiment.app,
                evaluations: evaluation.app,
                automation: this.composedAutomation.app,
                codingAgentApp: this.composedCodingAgent.app,
                projects: this.composedProject.app,
                ...this.composedEnterprise.application,
                // The checkout, portal, invoice and seat-change half of
                // `subscription.*`. Empty off Stripe, which is what makes the
                // surface report that this deployment does not bill.
                ...this.composedBillingWebhook.application,
                authzApp: permissions,
                dashboard: dashboard.app,
                dataset: this.composedDataset.app,
                evaluatorApp: this.composedEvaluator.app,
                featureFlag: featureFlag.app,
                prompts: this.composedPrompt.app,
                gateway: this.composedGateway.app,
                github,
                langy: this.composedLangy.app,
                ops: this.composedOps.app,
                monitors: this.composedMonitor.app,
                permissions: authz,
                roles: role.app,
                scenarios: this.composedScenario.scenarios,
                storedObjectApp: this.composedStoredObject.app,
                suites: this.composedScenario.suites,
                ...composeEnterpriseGovernanceApplication(this.resolveEnterprise()),
              },
            },
            report: trpcAbsence,
          })
        : undefined;
    // The hosted Model Context Protocol endpoint, served off the Node server ahead of the Hono
    // application because its Streamable HTTP and Server-Sent Events transports hold the raw
    // response for a session's life.
    const hostedMcp = tryCreateHostedMcpSurface({
      prisma: this.composedDatabase?.connection.client,
      encryption,
      authz,
      redis: queueInfrastructure?.redis ?? null,
      baseHost: options.config.infrastructure.execution.publicBaseUrl ?? "https://app.langwatch.ai",
    });
    // The built browser bundle, served by this process off the same listener.
    // `apps/ui` is a build, not a deployable: the image ships its `dist/client`
    // beside this app and the chart runs one interactive Deployment, so the pod
    // that answers `/api/*` is the pod a browser asks for `/`. Asked LAST, after
    // every claimed surface, because it is the fallback.
    const staticSurface = tryCreateApiStaticSurface({
      environment: globalThis.process.env,
      report: (message, context) => createLogger(options.config.serviceName).info(context, message),
    });
    const rawSurface = CompositeApiRawSurface.of([hostedMcp, staticSurface]);
    // The WebSocket upgrade path (ADR-128): one router shared with a second
    // registrant should this process ever gain one (`api-upgrade-router.ts`'s
    // own docblock). Built only when the transport composed, so a deployment
    // with no connected-agent capability answers every upgrade 404 through
    // the plain listener rather than mounting a router with nothing on it.
    const langyLocalGateway = this.composeLangyLocalGateway();
    const connectedAgentsUpgradeRouter =
      this.composedConnectedAgents || langyLocalGateway ? ApiUpgradeRouter.create() : undefined;
    // The shared folder's own socket (ADR-129), on the SAME router: one
    // `upgrade` listener per process, two registered paths.
    if (langyLocalGateway && connectedAgentsUpgradeRouter) {
      langyLocalGateway.mount(connectedAgentsUpgradeRouter);
      options.resources?.own("api langy local control gateway", () => langyLocalGateway.close());
    }
    if (this.composedConnectedAgents && connectedAgentsUpgradeRouter) {
      this.composedConnectedAgents.mount(connectedAgentsUpgradeRouter);
      // Drain order (ADR-128): the listener stops taking new upgrades first
      // (`closeApiProcessResources`'s own listener-close phase), then this
      // closes the socket, the long-poll transport and the runtime, then the
      // rest of `options.resources`' registrations release.
      options.resources?.own("api connected-agent transport", () =>
        this.composedConnectedAgents!.close(),
      );
    }
    const process = ApiProcess.create({
      agents,
      ...(features ? { features } : {}),
      // Read once, in api.config.ts, and handed down: every mounted surface
      // validates its declared outputs or none of them does.
      validateOutput: options.config.validateTrpcOutput,
      requestPolicy: this.requestPolicy,
      ...this.composeDoors(
        authz,
        tenancy,
        options.config.serviceName,
        options.config.infrastructure.execution.publicBaseUrl,
        options.config.infrastructure.execution.nlpServiceUrl,
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
        ...(rawSurface ? { rawSurface } : {}),
        ...(connectedAgentsUpgradeRouter ? { upgrades: connectedAgentsUpgradeRouter } : {}),
      },
    });

    return ApiProductionProcess.create(process, this.composedAgents?.runtime);
  }

  /**
   * The request policy this process enforces with, once it has been composed.
   */
  policy(): ApiRequestPolicy | undefined {
    return this.requestPolicy;
  }

  /**
   * The two AuthZ contract services this process serves, once composed.
   */
  authz(): { permissions: AuthzService; grants: AuthzGrantsService } | undefined {
    if (this.composedAuthz) {
      return { permissions: this.composedAuthz.permissions, grants: this.composedAuthz.grants };
    }
    return undefined;
  }

  /**
   * The organization, project and API-key services this process composed for itself, once it
   * has. `undefined` when a host supplied the pair instead, and `undefined` before `compose`.
   */
  tenancy(): ApiTenancyComposition | undefined {
    return this.composedTenancy;
  }

  /**
   * The feature ports this process owns, once it has been composed. `undefined` before
   * `compose`, and deliberately so: the rate limiter counts in the SAME Redis the queue
   * infrastructure composed, and that connection does not exist until the process does.
   */
  restFeaturePorts(): ApiOwnedRestFeaturePorts | undefined {
    return this.composedFeaturePorts;
  }

  /**
   * The optional collaborators this process resolved for itself, once composed.
   *
   * Every one of them used to be an option a host supplied and nothing did: `api.main.ts`
   * composes with no options at all, so an "optional" port with no fallback was a surface that
   * refused on every deployment. This is the read that says which of them the process now
   * answers from its own graph — `undefined` where the graph it stands on is genuinely absent.
   */
  optionalPorts(): Readonly<{
    viewerProtections: ApiViewerProtectionsPort | undefined;
    simulations: ApiSimulationEvidencePort | undefined;
    personMail: ApiPersonMailPort | undefined;
    seatAllowances: ApiSeatAllowancePort | undefined;
  }> {
    return {
      viewerProtections: this.resolveViewerProtections(),
      simulations: this.resolveSimulationEvidence(),
      personMail: this.resolvePersonMail(),
      seatAllowances: this.composedSeatAllowances,
    };
  }

  /**
   * The process's one guarded Prisma connection, once it has been composed. `undefined` before
   * `compose`, and `undefined` after it when the deployment configured no `DATABASE_URL` — the
   * same degradation Redis has.
   */
  database(): PrismaConnection | undefined {
    return this.composedDatabase?.connection;
  }

  /**
   * The project's stored credentials, over this process's own connection and its own
   * cipher. Absent where it holds neither: a deployment given no key can neither read
   * nor write a secret, so it mounts no door that would pretend to.
   */
  secrets(): SecretApi | undefined {
    return this.composedSecret?.app;
  }

  /** Installs the feature only where this process holds both a connection and a cipher. */
  private async resolveSecretApp(
    encryption: SecretEncryptionPort | undefined,
  ): Promise<ComposedSecretFeature | undefined> {
    const database = this.composedDatabase;
    if (!database || !encryption) return undefined;

    return await installApiSecret({ prisma: database.connection.client, encryption });
  }

  private allocateAgent(options: ApiRuntimeCompositionOptions): AgentApi {
    this.agentRelayMaxPayloadMb = options.config.infrastructure.connectedAgents.relayMaxPayloadMb;
    if (this.options.agents) {
      this.agentApi = this.options.agents;
      return this.agentApi;
    }
    if (!this.composedDatabase) {
      throw new Error("Agent installation requires a database or an injected AgentApi.");
    }
    this.agentClients.declare(AgentApi);
    this.agentApi = this.agentClients.reference(AgentApi);
    options.resources.own("agent peer clients", () => this.agentClients.close());
    return this.agentApi;
  }

  private async installAgent(options: ApiRuntimeCompositionOptions): Promise<void> {
    if (this.options.agents) return;
    const database = this.composedDatabase?.connection;
    const permissions = this.composedAuthz?.app;
    const auditLog = this.composedAuditLog;
    if (!database || !permissions || !auditLog) {
      throw new Error("Agent installation requires database, authorization and audit-log APIs.");
    }
    const publicBaseUrl = options.config.infrastructure.execution.publicBaseUrl;
    if (!publicBaseUrl) {
      throw new Error("Agent installation requires the configured public base URL.");
    }

    this.composedAgents = await installApiAgent({
      database,
      infrastructure: {
        redis: this.composedQueueRedis,
      },
      config: {
        publicBaseUrl,
        connected: options.config.infrastructure.connectedAgents,
        httpTesting: true,
      },
      peers: {
        apiKeys: this.composedApiKey.app,
        auditLog,
        permissions,
        projects: this.composedProject.app,
        scenarios: this.composedScenario.scenarios,
        traces: this.composedTrace.traces,
        users: this.composedUser.app,
        workflows: this.composedWorkflow.app,
      },
    });
    this.agentClients.bind(AgentApi, this.composedAgents.agents);
    this.agentClients.ready();
    options.resources.own("agent feature", () => this.composedAgents!.runtime.stop());
  }

  /**
   * The two doors this process opens on one credential resolution: the public REST families,
   * and the subscription lane beside them. Each REST family is the packaged builder over the
   * one {@link ApiRestSecurity}.
   */
  /**
   * The evaluation surface, over this process's own graph. Four things gate
   * it, and every one is something an evaluation READS: the studio graph its
   * custom evaluators are published from, the trace it re-scores, the routed
   * ClickHouse its run history is written to, and the retention cascade that
   * history is floored by.
   */
  private async installEvaluation(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
    retention: ComposedDataRetentionFeature | undefined,
  ): Promise<ComposedEvaluationFeature | undefined> {
    const workflowRuntime = this.composedWorkflowRuntime;
    const modelProviders = this.composedModelProviders;
    const eventing = this.composedEventing?.eventSourcing;
    const resolveClickHouse = this.composedClickHouse?.resolveClient;
    if (!infrastructure || !workflowRuntime || !modelProviders || !eventing) return undefined;
    if (!retention || !resolveClickHouse) return undefined;

    const logger = createLogger(options.config.serviceName);

    return await installApiEvaluation({
      infrastructure,
      peers: {
        workflows: this.composedWorkflow.app,
        traces: this.composedTrace.traces,
        modelProviders,
      },
      collaborators: {
        // The studio's own re-score, over the process's ONE evaluator runtime.
        // Resolved at the call rather than passed as a value: the runtime is
        // built FROM the evaluator service and the trace read stack, and an
        // absent one still refuses by name a layer down.
        runTraceEvaluation: (input) =>
          this.requireEvaluatorExecution().runEvaluationForTrace(input),
        // One liveness probe at the evaluator backend, down the engine's own
        // streaming route. A probe that cannot be sent is not a failed
        // evaluation, so the outcome is logged and swallowed.
        probeEvaluatorRuntime: async ({ projectId }) => {
          const { nlpRuntime } = workflowRuntime;
          if (!(nlpRuntime instanceof HttpWorkflowNlpRuntimeAdapter)) return;
          try {
            await nlpRuntime.probe({ projectId });
          } catch (error) {
            logger.debug({ error, projectId }, "evaluator keep-alive probe failed");
          }
        },
        // This process sends no product signal for a completed run; the worker
        // that drains the pipeline is where a run is counted.
        trackEvaluationRan: () => undefined,
        environment: globalThis.process.env,
      },
      processName: options.config.serviceName,
      eventing,
      resolveClickHouse: resolveClickHouse as EvaluationClickHouseResolver,
      dataRetention: retention.service,
    });
  }

  /**
   * The evaluation feature, or the refusal a caller that cannot degrade needs.
   */
  private requireEvaluation(): ComposedEvaluationFeature {
    const evaluation = this.composedEvaluation;
    if (!evaluation) {
      throw new ApiEvaluationUnavailableError(
        "evaluation pipeline, so it cannot report a run's result",
      );
    }
    return evaluation;
  }

  /**
   * The five subsystem probes. Every one posts a canary back through this
   * deployment's own public boundary, so the origin is what decides whether
   * they exist at all; the automation application and the workflow lookup are
   * the two probes' own collaborators.
   */
  private composeHealthProbes(options: {
    publicBaseUrl: string | undefined;
    apiKeys: ApiResolvedTenancy["apiKeys"];
  }): HealthProbeRestPorts | undefined {
    const { publicBaseUrl, apiKeys } = options;
    const automationApp = this.composedAutomation.service;
    const workflowService = this.composedWorkflow.service;
    if (!publicBaseUrl || !automationApp || !workflowService) return undefined;

    return {
      resolveProjectByApiKey: async (token: string) => {
        const resolved = await apiKeys.findResolvedToken({ token });
        return resolved?.type === "legacyProjectKey" ? { id: resolved.project.id } : null;
      },
      publicBaseUrl,
      automation: () => automationApp,
      workflowExists: async (input: { workflowId: string; projectId: string }) => {
        try {
          await workflowService.getById({ id: input.workflowId, projectId: input.projectId });
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  private composeDoors(
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
    serviceName: string,
    publicBaseUrl: string | undefined,
    nlpServiceUrl: string | undefined,
  ): { rest: Hono } {
    // The ONE report that names every family this process does not serve,
    // whether its transport is unconverted or this process composed no service
    // for it. The registry decides which sentence each gets.
    const restAbsence = LoggedApiRestAbsence.create(createLogger(serviceName));
    // One credential resolution for every door: the API-key ceiling a route
    // installs on top of its access policy resolves through the same graph the
    // project door itself does, so the two cannot enforce differently.
    const credentials = {
      apiKeys: tenancy.apiKeys,
      authz,
      organizations: tenancy.organizations,
      audit: this.resolveAudit(),
    };
    const projectRestPolicy: ApiRestProjectPolicy = ApiRestSecurity.projectPolicy(credentials);
    // Every door on the registry, in the registry's own order — the
    // description locations first, so nothing with a parameterised segment can
    // shadow one. See `api-rest.doors.ts`.
    const rest = new Hono();
    // The process's ONE credential door, resolved before this method ran
    // because the secret families install over it.
    const handlerManagedCredentials = this.composedHandlerCredentials;
    // The OTLP receiver, over this process's own producer registration and its
    // own Redis. Absent where there is no command queue: a receiver with
    // nowhere to send a span would answer 200 to data it then drops.
    const payloads = composeApiTraceSpool({
      storage: this.composedStoredObject.storage,
      azureRetentionConfirmed: this.azureSpoolRetentionConfirmed,
      featureFlags: this.composedFeatureFlagApi,
      logger: createLogger("langwatch:api:trace-ingest:edge-spool"),
    });
    const otlpIngest = composeApiTraceIngest({
      governance: this.resolveEnterprise()?.governance,
      eventing: this.composedEventing?.eventSourcing,
      redis: this.composedQueueRedis,
      credentials: handlerManagedCredentials,
      // The one allowance both doors refuse an over-plan export with. Absent
      // where this process opened no ClickHouse, and the receiver says so.
      ...(this.composedUsageEnforcement ? { allowance: this.composedUsageEnforcement } : {}),
      processName: serviceName,
      // Edge media externalization, over the SAME content-addressed store the
      // scenario-event door writes through and the SAME privacy rules the
      // worker's content drop reads: a picture stored here is one object, and
      // it is not stored at all for a project whose policy discards it.
      media: {
        featureFlags: this.composedFeatureFlagApi,
        // Absent privacy rules fail CLOSED: with no policy to consult, the edge
        // externalizes no content it might have been told to discard.
        hasContentDropRules: (projectId) =>
          this.composedDataPrivacy?.app.dropsAnyContent({ projectId }) ?? Promise.resolve(true),
        ...(this.composedStoredObject.bytes
          ? { service: ApiTraceMediaStore.create(this.composedStoredObject.bytes) }
          : {}),
      },
      // The ADR-022 whole-payload spool, over the SAME byte storage the media
      // extraction in front of it externalizes into. Absent where this process
      // composed no object store, and the receiver says so.
      ...(payloads ? { payloads } : {}),
      report: LoggedApiTraceIngestAbsence.create(createLogger(serviceName)),
    });
    // The spend pipeline, registered producer-only. Registered BEFORE the
    // internal family is composed because that family's `/spend-commands`
    // route is the only reason a producer exists on this tier, and the voice
    // settlement it also serves confirms through the same registration.
    this.composedGatewaySpendPipeline = composeApiGatewaySpendPipeline({
      eventing: this.composedEventing?.eventSourcing,
      processName: serviceName,
      report: LoggedApiGatewaySpendPipelineAbsence.create(createLogger(serviceName)),
    });
    const bugReports = this.composeBugReports(tenancy);
    const unsubscribe = this.composeUnsubscribe();
    const cron = this.composeCron();
    const langyRest = this.composeLangyRest(publicBaseUrl);
    const githubRest = this.composeGithubRest(authz);
    // The back office. Both halves are already open at this line: the operator
    // application the `ops.*` namespace answers from, and the one session pair
    // every other handler-managed door reads.
    const adminRest = composeApiAdminRest({
      ops: this.composedOps.app,
      session: this.composedAuth?.compose(),
    });
    // The two halves of `/api/auth/cli`. The device grant is this process's
    // own — Redis, the directory, the credential service — and the governance
    // plane rides the SAME session reader the grant mints through, so the
    // writer and the reader of the CLI token keyspace can never be two
    // spellings of it.
    const authCliDeviceFlow = this.composeAuthCliDeviceFlow(authz, tenancy, publicBaseUrl);
    const governanceCli = this.composeGovernanceCliRest(authz, authCliDeviceFlow, publicBaseUrl);
    // The `/api/auth` family itself, over the SAME Better Auth instance this
    // process's session transport already reads. Registered after the two CLI
    // halves above, whose paths its catch-all would otherwise swallow.
    const authRest = this.composeAuthRest(tenancy);
    // The Activity Monitor's receivers, over the trace collection the OTLP
    // composition above already built — the same `trace_processing` producer
    // registration, never a second one.
    const governanceIngest = this.composeGovernanceIngestRest(otlpIngest?.otlp.traces);
    // The charted reads and the prompt library, over the SAME applications the
    // browser's `analytics.getTimeseries` and `prompts.*` procedures resolve
    // on. Taken from the halves rather than built a second time: two analytics
    // applications would let the public door and the dashboard disagree about
    // what a metric means, and two prompt services about what a project holds.
    const analytics = this.composedAnalytics.analytics;
    const promptApp = this.composedPrompt.app;
    // The governed-SQL family. Every collaborator is the analytics half's own,
    // so the API key's door and the workbench's door run one validator against
    // one catalogue; the saved charts sit on the same Dashboard application
    // the browser's dashboards do.
    const analyticsFeature = this.composedAnalytics;
    const dashboardFeature = this.composedDashboard;
    const projects = this.composedTenancy?.projects;
    const projectDirectory = this.composedTenancy?.projectDirectory;
    const langWatchQL =
      projects && dashboardFeature
        ? {
            collaborators: {
              featureFlags: () => analyticsFeature.featureFlags,
              projects: () => projects,
              langWatchQL: () => analyticsFeature.langWatchQL,
              protectionsFor: (input: { projectId: string; credential: RestCredentialPrincipal }) =>
                analyticsFeature.apiKeyProtections(input),
            },
            dashboard: dashboardFeature.restServices.dashboard,
          }
        : undefined;
    // The management family's five collaborators, or none. The organization object is the
    // identity half's own merged one — the canonical settings reads plus the membership
    // operations the contract does not declare — so the management door and the members screen
    // answer from one service. The share ledger and the plan provider are TAKEN from the halves
    // that composed them for the same reason.
    const organizationRest = this.composedOrganization.rest;
    const shares = this.composedShare?.app;
    const plans = this.composedPlanProvider;
    // The bulk run export. Composed only where this process holds BOTH a
    // browser-session transport and the simulation store: the session is what
    // makes a download attributable to a person, and the store is what it
    // sweeps. Without either the family is left off.
    const authSession = this.composedAuth?.compose();
    // ONE session port for every handler-managed family on this process. The
    // export, the Studio's two doors, the playground and the two generators
    // all resolve a person themselves, and two resolvers over the same
    // transport would be two answers to who somebody is.
    const authoringSession = authSession
      ? ApiHandlerManagedSession.create({
          auth: authSession.auth,
          sessions: authSession.sessions,
          authz,
        })
      : undefined;
    const simulations = this.composedScenario.simulations;
    const exportBroadcast = this.composedPresence.broadcast;
    // The bulk trace download, beside the bulk run download below. It reads
    // THROUGH the one read stack every other trace surface redacts through —
    // never a second one — so the stack decides it along with the session and
    // the progress fabric.
    const traceExportReads = this.composedTrace.traceReads;
    const traceExport =
      authoringSession && traceExportReads && exportBroadcast
        ? {
            reads: traceExportReads,
            session: authoringSession,
            broadcast: () => exportBroadcast,
          }
        : undefined;
    const scenarioRunExport =
      authoringSession && simulations && exportBroadcast
        ? {
            simulations: () => simulations,
            broadcast: () => exportBroadcast,
            session: authoringSession,
            recordExportRequested: async (entry: {
              userId: string;
              projectId: string;
              action: "scenarioRuns.export";
              targetKind: "project";
              targetId: string;
              args: Record<string, unknown>;
            }) => {
              await this.resolveAudit().record({
                actorId: entry.userId,
                path: entry.action,
                input: { projectId: entry.projectId, ...entry.args },
                error: null,
              });
            },
          }
        : undefined;
    // The four authoring doors — the Studio's completion and run dispatch, the playground, and
    // the two generators. Every one of them is a session door, so the transport composed above
    // is what decides whether any is mounted; beyond that each names its own second condition.
    // The studio dispatch is built through the SAME decision the `httpProxy.*` surface's is, so
    // an absent engine address means the same thing on both.
    const modelProviders = this.composedModelProviders;
    const workflowService = this.composedWorkflow.service;
    const authoring = composeApiAuthoringRest({
      session: authoringSession,
      modelProviders,
      projects,
      workflows: workflowService ? this.composedWorkflow.app : undefined,
      studioDispatch: this.composedStudioDispatch,
      nlpServiceUrl,
      report: LoggedApiAuthoringRestAbsence.create(createLogger(serviceName)),
    });
    // The experiment workbench's ten doors, over the SAME application the `experiments.*`
    // namespace answers from and the SAME run loop its own procedures start. Mounted where this
    // process holds a session (two of the doors are the browser's) and the execution half; the
    // run loop's own absence is answered inside the family, so a deployment with no progress
    // store still reads and writes a saved setup.
    const experimentRun = this.composedExperiment.run;
    const experimentService = this.composedExperiment.experiments;
    const experimentWorkbench =
      authoringSession && experimentService
        ? {
            session: authoringSession,
            experiments: () => this.composedExperiment.app,
            run: experimentRun,
          }
        : undefined;
    // The ONE find-or-create rule on this process. Constructed here and handed
    // to BOTH doors that resolve an SDK's `experiment_slug` — the create-or-take
    // call and the batch result log — because an SDK that got one experiment
    // from the first and a second from the other would split one run's results
    // across two rows nothing downstream can rejoin.
    const experimentFindOrCreate = experimentService
      ? composeApiExperimentFindOrCreate(experimentService)
      : undefined;
    const experimentInit = experimentFindOrCreate
      ? {
          credential: (input: { request: Request; permission: AuthzPermission }) =>
            handlerManagedCredentials.authenticate(input),
          findOrCreate: experimentFindOrCreate,
        }
      : undefined;
    // The three synchronous run URLs, over the SAME graph service the
    // workbench's own cells dispatch through — so a run started over REST and
    // one started as an experiment cell resolve one published version, not two.
    const workflowRun = experimentService
      ? {
          credential: (input: { request: Request; permission: AuthzPermission }) =>
            handlerManagedCredentials.authenticate(input),
          workflows: () => experimentRun.workflows,
        }
      : undefined;
    // The five subsystem probes, built once for both doors that read them: the
    // project-keyed `/api/health/*` family here, and the monitoring-keyed
    // platform-health family the process installed above.
    const healthProbes = this.composeHealthProbes({ publicBaseUrl, apiKeys: tenancy.apiKeys });
    // The SAME invitation service `organization.*` administers over tRPC, so a
    // provisioning tool that creates an invitation here and an administrator
    // who lists them in the app see one set of invitations with one acceptance
    // link each. Absent, the three invitation routes keep refusing by name.
    const organizationInvites = this.composedOrganizationInvites;
    const organizationManagement =
      organizationRest && shares && plans && projects
        ? {
            organizations: () => organizationRest,
            permissions: () => authz,
            plans: () => plans,
            shares: () => shares,
            projects: () => projects,
            audit: this.composeManagementAudit(),
            ...(organizationInvites
              ? {
                  invites: () => organizationInvites.rest,
                  buildInviteAcceptUrl: (inviteCode: string) =>
                    organizationInvites.buildInviteAcceptUrl(inviteCode),
                }
              : {}),
          }
        : undefined;
    // The public trace doors, over the SAME read stack the explorer and the
    // legacy grid answer from. Taken from the observability half rather than
    // built again: two read stacks would be two answers to what one caller may
    // see of one trace, and the redaction is the whole point of the stack.
    const traceGroup = this.composedTrace;
    const traceStack = traceGroup?.traceReads;
    const traceReads = traceStack
      ? {
          reads: traceStack,
          platformUrl: createPlatformUrlBuilder(publicBaseUrl),
          // The reserved-metadata amendment writes a synthetic span on the
          // SAME `trace_processing` registration everything else on this
          // process ingests through. Absent where the process registered no
          // queue, and then the PATCH route is not registered at all.
          ...(this.composedEventing
            ? {
                updateTraceMetadata: (input: {
                  projectId: string;
                  traceId: string;
                  metadata: Record<string, unknown>;
                }) => traceStack.explorerPorts().updateTraceMetadata(input),
              }
            : {}),
        }
      : undefined;
    const traceLegacy =
      traceGroup && traceStack && shares
        ? {
            traces: () => traceGroup.traces,
            shares: () => shares,
            reads: traceStack,
            credential: (input: { request: Request; permission: AuthzPermission }) =>
              handlerManagedCredentials.authenticate(input),
          }
        : undefined;
    // The SDK collector, over the SAME ingestion service the OTLP receiver
    // uses — one dedup gate, one producer registration. Its evaluation half is
    // the execution fold's own `reportEvaluation`, which is the same command
    // the workbench's re-scores travel on; without it the collector still
    // records spans and counts the evaluations as rejected by name.
    const reportEvaluation = this.composedEvaluation?.reportEvaluation;
    // The batch result log's three collaborators. All three travel together
    // because they are ONE write: the rows are a run's history, addressed by
    // the experiment the first of them resolved and scored by the verdict
    // command the third sends. A door holding two of the three would answer
    // 200 to results that land nowhere a customer can read them back.
    const evaluationBatch =
      experimentFindOrCreate && experimentService && reportEvaluation
        ? {
            findOrCreate: experimentFindOrCreate,
            // The SAME service the workbench's own cells write a run through,
            // so an SDK's batch and a workbench run produce one history.
            experiments: () => experimentService,
            reportEvaluation: (input: Record<string, unknown>) => reportEvaluation(input as never),
          }
        : undefined;
    // The four evaluate doors' collaborators. They stand on the evaluator RUNTIME, which is
    // what decides whether the doors are registered at all: a door that authenticates,
    // validates and then has nothing to run the evaluator with is one an SDK retries forever.
    const evaluatorExecution = this.resolveEvaluatorExecution();
    const evaluationDatabase = this.composedDatabase?.connection;
    const evaluationRun =
      this.composedEvaluators &&
      experimentService &&
      evaluationDatabase &&
      modelProviders &&
      evaluatorExecution &&
      reportEvaluation
        ? {
            prisma: evaluationDatabase.client,
            execution: evaluatorExecution,
            evaluators: this.composedEvaluators,
            experiments: experimentService,
            modelProviders,
            reportEvaluation: (input: Record<string, unknown>) => reportEvaluation(input as never),
            deriveEvaluatorId: (name: string) => this.evaluatorIdSlug.derive(name),
          }
        : undefined;
    const collector = otlpIngest
      ? {
          credential: otlpIngest.collectorCredential,
          ingestSpan: otlpIngest.ingestSpan,
          // The SAME allowance object the OTLP receiver holds. Two gates over
          // one service would still be one answer, but two SERVICES would not
          // — and a limit enforced on one door and not the other is a limit a
          // customer routes around by changing a URL.
          usageLimit: otlpIngest.usageLimit,
          ...(reportEvaluation
            ? {
                // The command's own data shape is the evaluation package's, and
                // the execution half publishes it opaquely; the collector's port
                // names the fields it actually sends.
                reportEvaluation: (input: Record<string, unknown>) =>
                  reportEvaluation(input as never),
              }
            : {}),
          // ONE instance of the slug rule on this process, so the collector,
          // the custom-evaluation sync and the evaluate doors derive one id
          // for one evaluation name.
          deriveEvaluatorId: (name: string) => this.evaluatorIdSlug.derive(name),
        }
      : undefined;
    // The DSPy optimizer's step log. Its cost enrichment is what kept it in the retired route
    // file: it prices every LLM call against the project's OWN stored rates, and a step
    // recorded with every cost null reads as a free run. So the family is mounted only where
    // this process composed the provider gateway the rules live behind, over the SAME service
    // the provider surface reads them through.
    const dspySteps =
      experimentFindOrCreate && experimentService && modelProviders
        ? {
            authenticateCredential: (input: { request: Request; permission: AuthzPermission }) =>
              handlerManagedCredentials.authenticate(input),
            findOrCreate: () => experimentFindOrCreate,
            experiments: () => experimentService,
            listModelCosts: async (input: { projectId: string }) =>
              (await modelProviders.listCosts(input)).map((cost) => ({
                model: cost.model,
                regex: cost.regex,
                ...(cost.inputCostPerToken !== null
                  ? { inputCostPerToken: cost.inputCostPerToken }
                  : {}),
                ...(cost.outputCostPerToken !== null
                  ? { outputCostPerToken: cost.outputCostPerToken }
                  : {}),
                ...(cost.cacheReadCostPerToken !== null
                  ? { cacheReadCostPerToken: cost.cacheReadCostPerToken }
                  : {}),
                ...(cost.cacheCreationCostPerToken !== null
                  ? { cacheCreationCostPerToken: cost.cacheCreationCostPerToken }
                  : {}),
                ...(cost.cacheCreation1hCostPerToken !== null
                  ? { cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken }
                  : {}),
              })),
          }
        : undefined;
    // The hosted MCP OAuth approval step. Three conditions, and each is
    // structural: the code lives in Redis for ten minutes, it embeds the
    // project's credential under this deployment's cipher, and it is minted
    // for the person the consent page authenticated.
    const mcpCipher = this.composedEncryption;
    const mcpRedis = this.composedQueueRedis;
    const mcpAuthorize =
      authoringSession && mcpCipher && projects
        ? {
            resolveSession: (request: Request) => authoringSession.resolve(request),
            findProject: async (projectId: string) => {
              const project = await projects.tryGetById(projectId);
              return project
                ? {
                    id: project.id,
                    apiKey: project.apiKey,
                    archivedAt: project.archivedAt,
                  }
                : null;
            },
            probeProjectPermission: (input: {
              session: { user: { id: string } };
              projectId: string;
              permission: AuthzPermission;
            }) =>
              authoringSession.permitted({
                session: input.session,
                projectId: input.projectId,
                permission: input.permission,
              }),
            // The demo project grants `project:view` to everybody, so the
            // permission probe above would PASS for it — which is why this is
            // its own answer, read off the deployment's own configuration.
            isDemoProject: (projectId: string) =>
              !!this.composedRestEnvironment.demoProjectId &&
              projectId === this.composedRestEnvironment.demoProjectId,
            encrypt: (value: string) => mcpCipher.encrypt(value),
            redis: mcpRedis ?? null,
          }
        : undefined;
    // The families that live in a feature package, bound to the services this
    // process already composed for its tRPC record. TAKEN rather than built a
    // second time, for the reason every other row on this file gives: two
    // applications over one project's rows let the SDK's door and the
    // browser's door answer the same question differently.
    const packaged = composeApiPackagedRest({
      agents: this.agentApi,
      connectedAgents: this.composedConnectedAgents,
      relayMaxPayloadMb: this.agentRelayMaxPayloadMb,
      scenario: this.composedScenario,
      analytics: this.composedAnalytics,
      authz,
      credentials: handlerManagedCredentials,
      encryption: this.composedEncryption,
      experiment: this.composedExperiment,
      workflow: this.composedWorkflow,
      // The two Enterprise governance slices the REST families are handed —
      // the SAME ones `ctx.app` carries, so the two doors cannot answer
      // differently.
      enterpriseGovernance: composeEnterpriseGovernanceApplication(this.resolveEnterprise()),
      presence: this.composedPresence,
      organization: this.composedOrganization,
      automation: this.composedAutomation,
      codingAgent: this.composedCodingAgent,
      enterprise: this.composedEnterprise,
      scim: this.composedScim,
      // The SAME application both user namespaces answer from: `/api/me` and
      // `/api/user-avatar` read one answer to who somebody is.
      users: this.composedUser.app,
      ...(this.composedDataset ? { dataset: this.composedDataset } : {}),
      ...(this.composedEvaluator ? { evaluator: this.composedEvaluator } : {}),
      ...(this.composedMonitor ? { monitor: this.composedMonitor } : {}),
      dashboard: this.composedDashboard,
      legacyErrors: ApiRestObservabilityComposition.create().legacyErrorHandler,
      storedObject: this.composedStoredObject,
      plans,
      publicBaseUrl,
      rateLimit: (request) => this.rateLimiter.consume(request),
      redis: this.composedQueueRedis,
      session: authoringSession,
      // The SAME dedup gate and command sender the OTLP receiver and the SDK
      // collector use, which is what makes a retried `POST /api/events/track`
      // and a redelivered SDK feedback event one recorded rating.
      traceIngest: otlpIngest,
      apiKeys: tenancy.apiKeys,
      organizations: tenancy.organizations,
      projects,
      projectDirectory,
      modelProviders,
      // The SAME ceiling the framework chain installs on a declared policy.
      requireApiKeyPermission: (permission) => projectRestPolicy.permissionMiddleware(permission),
      audit: this.resolveAudit(),
      managementAudit: this.composeManagementAudit(),
      isSaas: this.composedIsSaas,
      instanceAdminKey: this.composedFeaturePorts?.instanceAdminKey ?? (() => undefined),
      logger: createLogger(serviceName),
    });
    // The process's ONE REST runtime: every door on the registry is opened
    // through it, so identity, refusal rendering and the project facts are
    // resolved once for the whole process rather than once per family.
    const scim = this.composedScim;
    const restRuntime = createApiRestRuntime({
      projectCredential: (input) => handlerManagedCredentials.authenticate(input),
      organizationCredential: (input) => handlerManagedCredentials.authenticateOrganization(input),
      organizationIdentity: (input) => handlerManagedCredentials.identifyOrganization(input),
      routeAuthorization: (input) => handlerManagedCredentials.authorizeOrganizationRoute(input),
      errors: ApiRestObservabilityComposition.create().legacyErrorHandler,
      ...(packaged.ports.dualAuth ? { dualCredential: packaged.ports.dualAuth } : {}),
      // The SAME application the three SCIM families answer from: the bearer a
      // door accepts and the tenant a route then provisions cannot be resolved
      // by two objects.
      ...(scim
        ? {
            directoryCredential: ({ request }: { request: Request }) =>
              scim.authenticateDirectory({
                authorization: request.headers.get("authorization"),
              }),
          }
        : {}),
    });

    // Taken once rather than read off the root inside a provider: the three
    // are already composed at this line, and a provider that read them later
    // would be a second answer to whether the door exists at all.
    const platformHealth = this.composedPlatformHealth?.app;
    const secrets = this.composedSecret?.app;
    const suites = this.composedScenario.suites;

    for (const openedDoor of openApiRestDoors({
      report: restAbsence,
      context: {
        runtime: restRuntime,
        packaged,
        services: {
          ...this.composedAnnotation.restServices,
          ...this.composedStoredObject.restServices,
          analytics: () => analytics,
          ...(langWatchQL ? { langWatchQL } : {}),
          ...(organizationManagement ? { organizationManagement } : {}),
          ...(traceExport ? { traceExport } : {}),
          ...(scenarioRunExport ? { scenarioRunExport } : {}),
          ...(authoring ? { authoring } : {}),
          ...(experimentWorkbench ? { experimentWorkbench } : {}),
          ...(experimentInit ? { experimentInit } : {}),
          ...(evaluationBatch ? { evaluationBatch } : {}),
          ...(evaluationRun ? { evaluationRun } : {}),
          ...(workflowRun ? { workflowRun } : {}),
          ...(traceReads ? { traceReads } : {}),
          ...(traceLegacy ? { traceLegacy } : {}),
          organizations: () => tenancy.organizations,
          // The three applications the process used to route after everything
          // else. They are entries on the registry now, so their doors are
          // ordered with the rest rather than appended to them.
          ...(platformHealth ? { platformHealth: () => platformHealth } : {}),
          ...(secrets ? { secrets: () => secrets } : {}),
          suites: () => suites,
          // Mounted on every deployment, exactly as the retired platform
          // application mounted it: one that bills through nobody answers 404
          // there rather than serving a path that appears and disappears with
          // a credential.
          billingWebhook: () => this.composedBillingWebhook.webhook,
        },
        ports: {
          handlerManagedCredential: (input) => handlerManagedCredentials.authenticate(input),
          // The SAME counter the packaged REST families and the identity
          // throttles meter through, so a caller has one budget per rule.
          rateLimit: (request) => this.rateLimiter.consume(request),
          // The envelope every family that names none of its own answers in.
          errors: ApiRestObservabilityComposition.create().legacyErrorHandler,
          platformUrl: createPlatformUrlBuilder(publicBaseUrl),
          ...(otlpIngest ? { otlpIngest: otlpIngest.otlp } : {}),
          ...(collector ? { collector } : {}),
          ...(bugReports ? { bugReports } : {}),
          ...(unsubscribe ? { unsubscribe } : {}),
          ...(cron ? { cron } : {}),
          ...(langyRest ? { langy: langyRest } : {}),
          ...(githubRest ? { github: githubRest } : {}),
          ...(adminRest ? { admin: adminRest } : {}),
          ...(authCliDeviceFlow ? { authCliDeviceFlow } : {}),
          ...(governanceCli ? { governanceCli } : {}),
          ...(authRest ? { auth: authRest } : {}),
          ...(governanceIngest ? { governanceIngest } : {}),
          ...(publicBaseUrl ? { publicBaseUrl } : {}),
          ...(healthProbes ? { healthProbes } : {}),
          ...(this.composedOpsExplain
            ? { opsClickHouseExplain: this.composedOpsExplain.ports }
            : {}),
          ...(dspySteps ? { dspySteps } : {}),
          ...(mcpAuthorize ? { mcpAuthorize } : {}),
          imageProxy: {
            blockLocalHttpCalls: this.composedRestEnvironment.blockLocalHttpCalls,
            allowedHosts: this.composedRestEnvironment.allowedProxyHosts,
          },
        },
      },
    })) {
      rest.route("/", openedDoor);
    }

    return { rest };
  }

  /**
   * The AuthZ service this process authorizes with, and where it came from. Precedence, and the
   * reason for it: 1. An injected service wins.
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
   * The organization and API-key services this process serves, and where they came from.
   * Precedence, and the reason for it: 1. A host's PAIR wins. A host that already owns the
   * product graph has one of each per process. 2.
   */
  private async resolveTenancy(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
  ): Promise<ApiResolvedTenancy | undefined> {
    const { apiKeys, organizations } = this.options;
    // `create` has already refused a half-supplied pair, so one present means
    // both are.
    if (apiKeys && organizations) return { apiKeys, organizations };

    const logger = createLogger(options.config.serviceName);
    this.composedTenancy = await ApiTenancyComposition.tryCompose({
      database: this.composedDatabase?.connection,
      // The project application this process installs, as a reference: the
      // credential store reads projects through it and the project module
      // reads credentials back, so one side arrives before the other exists.
      projectApi: this.deferredApis.reference(ProjectApi),
      // The process's own scope, so the credential store's runtime is stopped
      // when this process drains or its composition fails half-built.
      resources: options.resources,
      // The pair this process composed, never a host's single service: an
      // injected AuthZ is already reflected in `authz`, and reading it back
      // here would be reading a service whose grants half we do not hold.
      authz: this.composedAuthz
        ? { permissions: this.composedAuthz.permissions, grants: this.composedAuthz.grants }
        : undefined,
      encryption,
      pepper: options.config.apiKeyPepper,
      // The LangWatchQL key map, over the ClickHouse this process opened above. A project
      // created here writes its key to the table the approved views read, so a governed
      // query against it resolves without waiting for the deploy-time backfill.
      ...(this.composedClickHouse && options.config.infrastructure.clickhouse.sourceDatabase
        ? {
            keyMap: LwqlKeyMapService.create({
              repository: LwqlKeyMapClickHouseRepository.create({
                resolveClient: this.composedClickHouse.resolveClient,
              }),
              sourceDatabase: options.config.infrastructure.clickhouse.sourceDatabase,
              connection: options.config.infrastructure.clickhouse.langwatchQl ?? null,
            }),
          }
        : {}),
      report: LoggedApiTenancyAbsence.create(logger),
    });
    if (!this.composedTenancy) return undefined;

    return {
      apiKeys: this.composedTenancy.apiKeys,
      organizations: this.composedTenancy.organizations,
    };
  }

  /**
   * The Auth graph this process authenticates browser callers with, and where it came from.
   * Precedence, and the reason for it: 1. An injected composition wins.
   */
  private async resolveAuth(
    options: ApiRuntimeCompositionOptions,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): Promise<ApiAuthSessionCompositionPort | undefined> {
    if (this.options.auth) return this.options.auth;
    if (!this.composedDatabase) return undefined;

    const logger = createLogger(options.config.serviceName);
    // The person graph FIRST: Auth resolves a signed-in person through the
    // user application, and the user application ends their sessions through
    // Auth. The runtime resolves that cycle, so this line is what makes the
    // browser-session boundary a reader of the one graph rather than a second.
    const user = await this.installUser(options, tenancy);
    this.composedAuth = ApiAuthComposition.tryCompose({
      auth: user.auth,
      // The SAME graph Better Auth's passkey ceremony, SCIM and the back
      // office read through: the installed user application itself.
      directory: user.app,
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
      // The gateway a password-reset link leaves through, over the deployment's
      // own host. Absent only where `BASE_HOST` is, and the refusal then says
      // so rather than reporting a link that was never minted.
      ...(this.composedMail
        ? { mail: ApiComposedPasswordResetMail.create(this.composedMail) }
        : {}),
      // The grant ledger a domain auto-join writes its membership through.
      // The pair this process composed, for the reason `resolveTenancy` gives.
      authzGrants: this.composedAuthz?.grants,
      // The SAME Redis Better Auth's own session cache lives in, so revoking a
      // session through this process clears the entry the other tier reads.
      redis: queueInfrastructure?.redis ?? null,
      // The identity event stack, which is what makes Better Auth's storage the identity
      // adapter and its account hooks the bridge ceremonies (ADR-116 §1, §5) rather than
      // the stock Prisma engine and three no-ops. The SAME registration every other
      // identity write on this process stages through.
      identityEventing: this.composedIdentityEventing,
      processName: options.config.serviceName,
      report: LoggedApiAuthAbsence.create(logger),
    });
    return this.composedAuth;
  }

  /**
   * The signed-in person's graph, installed ONCE. Both the browser-session
   * boundary and the person-shaped features reach it, and a second install
   * would be a second answer to who somebody is.
   */
  private installUser(
    options: ApiRuntimeCompositionOptions,
    tenancy: ApiResolvedTenancy,
  ): Promise<ComposedUserFeature> {
    const personMail = this.resolvePersonMail();
    // The project directory this process resolved its tenancy through. Read
    // rather than referenced: `/api/me/project` names the project a calling
    // key belongs to, and a second directory would name a different one.
    const projects = this.composedTenancy?.projects;
    if (!projects) {
      throw new Error("The user graph was installed before this process resolved a tenancy");
    }

    this.composedUserInstall ??= installApiUser({
      prisma: this.requireDatabase().connection.client,
      peers: {
        organizations: tenancy.organizations,
        projects,
        // ADR-027's mode, resolved once by the feature that owns the
        // signed-out doors: the account screens must report the mode the door
        // the person came through offered.
        resolveAuthProvider: () => this.composedAuthFeature.resolveAuthProvider(),
      },
      // The ONE registration this process made, taken rather than repeated:
      // the identifier ledger stages every command through it.
      eventing: this.composedIdentityEventing,
      // The SAME Redis Better Auth's own session cache lives in, so revoking a
      // session through this process clears the entry the other tier reads.
      redis: this.composedQueueRedis ?? null,
      // The SAME counter the public REST surface meters through, so a budget
      // cannot be spent twice by asking on two paths.
      rateLimit: (request) => this.rateLimiter.consume(request),
      deployment: this.personDeployment(options),
      // Where an uploaded avatar's bytes land: the content-addressed store the
      // stored-object feature opens, read at the UPLOAD rather than here. That
      // feature composes further down, so a store read at this line would
      // always be absent and every upload would refuse on a process that can
      // serve it.
      avatarStorage: ApiUserAvatarStorageAdapter.create({
        storedObjects: () => this.composedStoredObject?.bytes,
        processName: options.config.serviceName,
      }),
      // The SAME application `/api/files` reads through, in the shape the
      // avatar family takes. Its row carries the owner kind, which is what
      // makes the family's refusal of every non-avatar object a real check.
      avatarObjects: createApiUserAvatarObjectReader(() => this.composedStoredObject.app),
      // The spend rollup behind `/api/me/usage`. Enterprise governance owns the
      // ledger, so a deployment without it refuses by name rather than
      // reporting a zero somebody would read as "you spent nothing".
      personalUsage: () => this.resolveEnterprise()?.governance,
      ...(personMail ? { mail: personMail } : {}),
      processName: options.config.serviceName,
    });

    return this.composedUserInstall;
  }

  /**
   * Composes the process's producer-only Eventing runtime over its own queue.
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
      killSwitch: EventingKillSwitchAdapter.create(this.composedFeatureFlagApi),
      report: LoggedApiEventingAbsence.create(logger),
    });
  }

  private composeBugReports(tenancy: ApiResolvedTenancy): BugReportRestPorts | undefined {
    const database = this.composedDatabase?.connection;
    if (!database) return undefined;
    const reports = PrismaBugReportRepository.create({ prisma: database.client });
    return {
      reports: () => reports,
      // The process's ONE counter, the same one every other public rule meters
      // through: two limiters would give one address two flood budgets.
      rateLimiter: { consume: (input) => this.rateLimiter.consume(input) },
      // This deployment alerts nowhere: intake already succeeded, and a
      // notifier that threw would fail a report that was written.
      notifier: { notify: () => Promise.resolve() },
      credentials: (request) => extractApiKeyRequestCredentials(request),
      apiKeys: () => tenancy.apiKeys,
    };
  }

  /**
   * The internal cron family's collaborators, or `undefined` with no
   * `CRON_API_KEY`: the sweep behind this door deletes Lambda functions, so
   * an unauthenticated caller must not be mounted rather than refused.
   */
  private composeCron(): CronRestPorts | undefined {
    const secret = this.composedCronApiKey;
    if (!secret) return undefined;
    const cleanup = this.composedNlpLambdaCleanup;
    return {
      internalSecret: () => secret,
      cleanupOldLambdas: async () => {
        if (!cleanup) {
          throw new Error(
            "This deployment composed no per-project NLP Lambda account, so there is nothing to sweep.",
          );
        }
        await cleanup.sweep();
      },
    };
  }

  /**
   * The one-click unsubscribe door's collaborators, or `undefined` where this
   * process composed no automation application.
   */
  private composeUnsubscribe(): UnsubscribeRestPorts | undefined {
    const automation = this.composedAutomation.service;
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
   */
  private composeLangyRest(publicBaseUrl: string | undefined): ApiLangyRestComposition | undefined {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const authz = this.composedAuthz?.permissions ?? this.options.authz;
    if (!database || !tenancy || !authz) return undefined;
    const credentials = ApiHandlerManagedCredentials.create({
      apiKeys: tenancy.apiKeys,
      authz,
      organizations: tenancy.organizations,
    });
    return composeApiLangyRest({
      langy: this.composedLangy.app,
      apiKeys: tenancy.apiKeys,
      featureFlags: this.composedFeatureFlagApi,
      // The guarded client this process already opened, read through the two
      // fields the actor bridge selects. A second directory would be a second
      // answer to "who owns this key".
      actors: database.client,
      enforceCeiling: (input) => credentials.enforceCeiling(input),
      redis: this.composedQueueRedis,
      internalSecret: this.composedLangyInternalSecret,
      metrics: apiLangyRestMetrics(),
      // Resolved at the dispatch rather than passed as a value: the experiment
      // feature is composed after this one, and an away page is only ever run
      // for once a request is in flight.
      workbench: () => {
        const experiments = this.composedExperiment.experiments;
        if (!experiments) return null;
        return {
          experiments,
          run: this.composedExperiment.run,
          trySlugOf: async (projectId) =>
            (await tenancy.projects.tryGetSummaryById(projectId))?.slug ?? null,
        };
      },
      local: this.composeLangyLocal(database.client, publicBaseUrl),
    });
  }

  /**
   * The worker's door onto the developer's own folder (ADR-129), over this
   * process's guarded client and the SAME conversation writer every other
   * Langy write goes through.
   */
  private composeLangyLocal(
    prisma: NonNullable<ApiProductionComposition["composedDatabase"]>["connection"]["client"],
    publicBaseUrl: string | undefined,
  ): ApiLangyLocalOptions | undefined {
    const commands = this.composedAgentPipelines?.langyConversations;
    const longPoll = this.composeLangyLocalLongPoll();
    if (!commands || !longPoll) return undefined;
    const github = this.composedGithub;
    return {
      runtime: this.composeLangyLocalRuntime(prisma, commands),
      longPoll: longPoll,
      commands,
      users: {
        tryReadPreference: async (userId) =>
          (
            await prisma.user.findUnique({
              where: { id: userId },
              select: { langyCodeAccessPreference: true },
            })
          )?.langyCodeAccessPreference ?? null,
      },
      // A deployment with no GitHub App answers "not installed", which is the
      // state the code access card should show anyway.
      github: {
        readInstallation: async (projectId) => {
          const organizationId = (
            await prisma.project.findUnique({
              where: { id: projectId },
              select: { team: { select: { organizationId: true } } },
            })
          )?.team?.organizationId;
          if (!organizationId || !github) return { installed: false };
          const usable = (await github.getAllForOrganization(organizationId)).filter(
            (row) => row.suspendedAt == null,
          );
          const first = usable[0];
          return first
            ? { installed: true, accountLogin: first.accountLogin }
            : { installed: false };
        },
      },
      providerRows: this.composeLangyProviderRows(prisma),
      baseHost: publicBaseUrl,
    };
  }

  /**
   * Every provider row whose scope set reaches one project: the organization's,
   * its team's and its own, which is the chain the model-provider listing
   * resolves. What the skip gate reads its allowed models off.
   */
  private composeLangyProviderRows(
    prisma: NonNullable<ApiProductionComposition["composedDatabase"]>["connection"]["client"],
  ): SkipPermissionsProviderRows {
    return {
      findAllAccessibleForProject: async (projectId) => {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { teamId: true, team: { select: { organizationId: true } } },
        });
        if (!project) return [];
        return prisma.modelProvider.findMany({
          where: {
            scopes: {
              some: {
                OR: [
                  { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
                  { scopeType: "TEAM", scopeId: project.teamId },
                  { scopeType: "PROJECT", scopeId: projectId },
                ],
              },
            },
          },
          select: {
            id: true,
            provider: true,
            routingHandle: true,
            createdAt: true,
            langySkipPermissionsModels: true,
          },
        });
      },
    };
  }

  /**
   * ONE local-control runtime for this process, shared by the worker's REST
   * door and the panel's own procedures. The store is the shared Redis when
   * there is one and process memory otherwise, which is the rule connected
   * agents follow (ADR-093, ADR-128).
   */
  private composeLangyLocalRuntime(
    prisma: NonNullable<ApiProductionComposition["composedDatabase"]>["connection"]["client"],
    commands: LangyConversationCommands,
  ): LocalControlRuntime {
    if (this.composedLangyLocalRuntime) return this.composedLangyLocalRuntime;
    const redis = this.composedQueueRedis;
    this.composedLangyLocalRuntime = LangyLocalControlRuntimeAdapter.create({
      store: this.composeLangyLocalStore(redis ?? null),
      projects: {
        tryReadOrganizationId: async (projectId) =>
          (
            await prisma.project.findUnique({
              where: { id: projectId },
              select: { team: { select: { organizationId: true } } },
            })
          )?.team?.organizationId ?? null,
      },
      // This process mints no Langy session keys — that is the worker's, and
      // every other Langy credential port here refuses for the same reason.
      // The request is still recorded; the refusal names the cause.
      mintSessionKey: () => Promise.reject(new ApiLangySessionKeyUnavailableError()),
      events: commands,
      buffer: redis
        ? LangyTokenBufferRedisRepository.create({ redis })
        : LangyLocalControlRuntimeAdapter.nullBuffer(),
    });
    return this.composedLangyLocalRuntime;
  }

  /** The store the local-control runtime shares with connected agents: Redis when there is one. */
  private composeLangyLocalStore(redis: RedisConnection | null): SessionStateStore {
    return redis ? SessionStateStoreFactory.redis(redis) : SessionStateStoreFactory.memory();
  }

  /**
   * The RFC 8628 CLI device grant's collaborators, or none.
   */
  private composeAuthCliDeviceFlow(
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
    publicBaseUrl: string | undefined,
  ): AuthCliDeviceFlowApi | undefined {
    const auth = this.composedAuth?.compose();
    return composeApiAuthCliDeviceFlow({
      redis: this.composedQueueRedis,
      prisma: this.composedDatabase?.connection.client,
      // The signed-in PERSON rather than the whole session: both doors bind
      // their flow to who is acting, and the session carries a profile neither
      // reads.
      session: auth
        ? async (request) =>
            (await AuthSessionApiAuthenticationAdapter.create(auth).authenticate(request))?.user ??
            null
        : undefined,
      apiKeys: tenancy.apiKeys,
      organizations: this.composedOrganization.app,
      authz,
      featureFlags: this.composedFeatureFlagApi,
      publicBaseUrl,
    });
  }

  /**
   * The `/api/auth` family's collaborators, or none.
   */
  private composeAuthRest(tenancy: ApiResolvedTenancy): AuthDoorApi | undefined {
    const auth = this.composedAuth?.compose();
    return composeApiAuthRest({
      betterAuth: this.composedAuth?.betterAuth,
      sessions: auth?.sessions,
      auth: auth?.auth,
      apiKeys: tenancy.apiKeys,
      prisma: this.composedDatabase?.connection.client,
      featureFlags: this.composedFeatureFlagApi,
    });
  }

  /**
   * The CLI governance plane's collaborators, or none. The bearer reader is taken FROM the
   * device grant's own session service rather than built here: the grant writes the token
   * records and this half reads them, so one implementation of the keyspace is the whole point.
   */
  private composeGovernanceCliRest(
    authz: AuthzService,
    deviceFlow: AuthCliDeviceFlowApi | undefined,
    publicBaseUrl: string | undefined,
  ): GovernanceCliRestPorts | undefined {
    const sessions = deviceFlow?.sessions;
    return composeApiGovernanceCliRest({
      governance: this.resolveEnterprise()?.governance,
      accessTokens: sessions
        ? {
            resolve: (authHeader) => sessions.tryResolveAccessToken(authHeader),
            revoke: (input) => sessions.revokeAccessToken(input),
          }
        : undefined,
      prisma: this.composedDatabase?.connection.client,
      organizations: this.composedOrganization.app,
      plans: this.composedPlanProvider,
      authz,
      // The gateway group holds the spend decisions and this process does not
      // compose it; the family says so by answering `{ok: true}` rather than
      // guessing at a balance it cannot read.
      budgets: undefined,
      publicBaseUrl,
    });
  }

  /**
   * The SCIM 2.0 provisioning application, or none.
   */
  private installScim(serviceName: string): Promise<ScimApi | undefined> {
    const session = this.composedAuth?.compose();
    return installApiScim({
      prisma: this.composedDatabase?.connection.client,
      grants: this.composedAuthz?.grants,
      users: session?.users,
      auth: session?.auth,
      governance: this.resolveEnterprise()?.governance,
      plans: this.composedPlanProvider,
      eventing: this.composedIdentityEventing,
      managementAudit: this.composeManagementAudit(),
      provenOffboarding: this.composedScimEnvironment.provenOffboarding,
      auth0WebhookSecret: this.composedScimEnvironment.auth0WebhookSecret,
      report: LoggedApiScimAbsence.create(createLogger(serviceName)),
    });
  }

  /**
   * The Activity Monitor's receivers' collaborators, or none.
   */
  private composeGovernanceIngestRest(
    traceCollection: GovernanceIngestTraceCollectionPort | undefined,
  ): GovernanceIngestRestPorts | undefined {
    return composeApiGovernanceIngestRest({
      governance: this.resolveEnterprise()?.governance,
      projects: this.composedTenancy?.projects,
      traceCollection,
      prisma: this.composedDatabase?.connection.client,
      // The SAME counter every other throttle on this process meters through.
      rateLimit: (request) => this.rateLimiter.consume(request),
    });
  }

  /**
   * The GitHub App installation door's collaborators, or none. The session is the gate.
   */
  private composeGithubRest(authz: AuthzService): GithubInstallApi | undefined {
    const auth = this.composedAuth?.compose();
    return composeApiGithubRest({
      github: this.composedGithub,
      // The signed-in PERSON rather than the whole session: both doors bind
      // their flow to who is acting, and the session carries a profile neither
      // reads.
      session: auth
        ? async (request) =>
            (await AuthSessionApiAuthenticationAdapter.create(auth).authenticate(request))?.user ??
            null
        : undefined,
      authz,
      audit: this.resolveAudit(),
      // The SAME coding-agent application the `codingAgents.*` namespace reads,
      // so the install follow-up maps the branches this organization's own
      // sessions already named.
      ...(this.composedCodingAgent.service
        ? { codingAgents: this.composedCodingAgent.service }
        : {}),
      prompts: () => this.composedPrompt.app,
    });
  }

  /** Policy construction precedes audit installation; resolve its API when recording. */
  private resolveAudit(): ApiAuditPort {
    this.composedAudit ??=
      this.options.audit ??
      composeApiAudit({
        auditLog: () => this.composedAuditLog,
        report: LoggedApiAuditAbsence.create(createLogger("langwatch:api:audit")),
      });
    return this.composedAudit;
  }

  /**
   * The audit log the operator and evaluator surfaces record and read through.
   * Composed by {@link compose} before any feature reads it; a process that
   * opened no database never builds the infrastructure record that names it.
   */
  private resolveAuditLog(): AuditLogApi {
    if (!this.composedAuditLog) {
      throw new Error(
        "API composition read the audit log before it installed one: the audit-log feature is booted with the database, ahead of every feature that records on it.",
      );
    }
    return this.composedAuditLog;
  }

  /**
   * The Enterprise application, member by member: the one a host supplied, else the members
   * this process composed for itself. Never a merge of the two — a host that states the slot
   * states all of it, and a partial injection silently backed by our own graph would leave
   * nobody able to say which member answered.
   */
  private resolveEnterprise(): ApiEnterpriseApplicationPort | undefined {
    return this.options.enterprise ?? this.composedEnterpriseApplication;
  }

  /**
   * Single sign-on, over this deployment's own connection ledger and licence.
   *
   * No credential reads: this process mounts no provider — see
   * `api-better-auth.composition.ts` — so `providerIsMounted()` stays false and
   * `resolveProvider()` answers `"email"` whatever `NEXTAUTH_PROVIDER` names.
   */
  private async composeSso(
    options: ApiRuntimeCompositionOptions,
  ): Promise<EnterpriseApiSso | undefined> {
    const auditLog = this.composedAuditLog;
    if (!auditLog) return undefined;

    return EnterpriseApiSso.create({
      configuration: {
        isSaas: this.composedIsSaas,
        provider: this.options.identity?.authProvider ?? "email",
        // The origin the browser session is issued for, else the deployment's
        // own public host. Inert on this process, which mounts no provider.
        baseUrl:
          options.config.browserSession?.baseUrl ??
          options.config.infrastructure.execution.publicBaseUrl ??
          "https://app.langwatch.ai",
      },
      // The MEMBER, not the application: a deployment that composed a
      // session-policy store and no connection ledger refuses here by name.
      connections:
        this.resolveEnterprise()?.backoffice?.() ?? ApiUnavailableSsoConnectionLedger.create(),
      logger: ApiSsoGateLogger.create(createLogger("langwatch:api:sso")),
      peers: {
        licensing: this.composedEnterprise.application.licensing,
        // The SAME ADMIN_EMAILS staff list every other back-office gate on this
        // process reads, deliberately not `ops:*`.
        operators: this.composedOps.app,
        users: this.composedUser.app,
        auditLog,
      },
    });
  }

  /** Who this deployment counts as a platform operator, by address, composed once. */
  private platformOperators(options: ApiRuntimeCompositionOptions): PlatformOperatorPort {
    this.composedPlatformOperators ??= (() => {
      const access = AdminAccessService.create({
        adminEmails: this.personDeployment(options).adminEmails ?? "",
      });
      return { isPlatformOperatorEmail: ({ email }) => access.isAdmin({ email }) };
    })();
    return this.composedPlatformOperators;
  }

  /**
   * Bridges the packaged families' management-audit port onto this process's
   * audit sink. The port names the action, not the URL, so the action is what
   * lands in `path` — it is the stable identifier of what was done.
   */
  private composeManagementAudit(): AppRestManagementAuditPort {
    const audit = this.resolveAudit();
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
   * Binds the two API-owned ports to this process's parsed config and its queue's Redis.
   */
  private composeFeaturePorts(
    options: ApiRuntimeCompositionOptions,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ApiOwnedRestFeaturePorts {
    const instanceAdminKey = ApiInstanceAdminKeyAdapter.create({ config: options.config });
    this.composedQueueRedis = queueInfrastructure?.redis;
    this.composedLangyInternalSecret = options.config.langyInternalSecret;
    this.composedLangyPublicBaseUrl = options.config.infrastructure.execution.publicBaseUrl;
    this.composedCronApiKey = options.config.cronApiKey;
    this.composedNlpLambdaCleanup = composeNlpLambdaCleanup(options.config.nlpLambdaFleet);
    return {
      instanceAdminKey: () => instanceAdminKey.read(),
      rateLimit: (request) => this.rateLimiter.consume(request),
    };
  }

  /** Open before tenancy so newly created projects can publish their LangWatchQL keys. */
  private resolveClickHouse(
    options: ApiRuntimeCompositionOptions,
  ): ApiClickHouseInfrastructure | undefined {
    if (this.composedClickHouse) return this.composedClickHouse;
    const database = this.composedDatabase?.connection;
    if (!database) return undefined;

    this.composedClickHouse = ApiClickHouseInfrastructure.tryCreate({
      resources: options.resources,
      clickhouse: options.config.infrastructure.clickhouse,
      // The routing directory, over the three kinds of tenant the event store
      // carries: a project names its owner, an organization names itself, and
      // a user is platform-level. The SAME implementation the worker process
      // composes — a project-only directory here answered an organization- or
      // user-tenanted read with a refusal the worker never gave.
      directory: bindTenantDirectoryReader(database.client),
      report: LoggedApiClickHouseAbsence.create(createLogger(options.config.serviceName)),
    });
    return this.composedClickHouse;
  }

  /**
   * Opens this process's ClickHouse and composes the analytics half of the collaborator set
   * over it.
   */
  private composeAnalytics(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
  ): ComposedAnalyticsFeature {
    const database = this.composedDatabase?.connection;
    // The project service, and this process's OWN: three of the four things below are project
    // row reads — which organization a tenant routes to, which organization a rollout flag
    // targets, and which team a data-privacy policy is inherited down from. A host that
    // injected its own api-key and organization pair composed no tenancy here, so it holds the
    // collaborator set whole and hands it in rather than having this half built for it.
    const projects = this.composedTenancy?.projects;
    // The resolved privacy policy the charted reads redact by. Taken rather
    // than built: a second resolution would let a chart and the traces behind
    // it disagree about which fields a project keeps.
    const dataPrivacy = this.composedDataPrivacy;
    if (!database || !projects || !dataPrivacy) return refusingAnalyticsFeature();

    return composeAnalyticsFeature({
      prisma: database.client,
      authz,
      projects,
      dataPrivacy: dataPrivacy.app,
      featureFlags: this.composedFeatureFlagApi,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      langWatchQL: options.config.infrastructure.clickhouse.langwatchQl,
      resources: options.resources,
    });
  }

  /**
   * Composes the three person-shaped features: the two signed-out doors, the signed-in person's
   * account, and the project's credentials.
   */
  private async composePersonFeatures(
    options: ApiRuntimeCompositionOptions,
    tenancy: ApiResolvedTenancy,
  ): Promise<void> {
    const database = this.composedDatabase?.connection;
    const composedTenancy = this.composedTenancy;
    const projects = composedTenancy?.projects;
    const processName = options.config.serviceName;
    // The credential application this process serves from, injected by a host or
    // installed here. It is the SAME object every REST door authenticates a
    // caller through, so this surface never has a second answer to what a key is
    // and never a refusing twin standing in for one.
    this.composedApiKey = composeApiKeyFeature({
      audit: this.resolveAudit(),
      app: tenancy.apiKeys,
    });
    // A host that injected its own api-key and organization pair composed no
    // tenancy here, so it holds the collaborator set whole and hands it in
    // rather than having these features built for it.
    if (!database || !projects || !composedTenancy) {
      this.composedUser = refusingUserFeature(processName);
      this.composedAuthFeature = composeAuthFeature(this.composedUser.auth);
      return;
    }

    // The signed-in person's own graph, installed here or already installed by
    // the browser-session boundary: `installUser` memoises, so both callers
    // reach ONE user application and one browser-session service. Auth installs
    // on that same runtime, so this line binds the application that install
    // already built rather than composing a second signed-out door.
    this.composedUser = await this.installUser(options, tenancy);
    this.composedAuthFeature = composeAuthFeature(this.composedUser.auth);
  }

  /**
   * Composes a reviewer's annotations, their scores and the queues they travel in. One gate,
   * and it is the database: every port here is a row read with a project or user id already in
   * hand.
   */
  private async installAnnotation(
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): Promise<ComposedAnnotationFeature> {
    const permissions = this.composedAuthz?.app;
    if (!infrastructure || !permissions) {
      return refusingAnnotationFeature();
    }

    return installApiAnnotation({
      infrastructure,
      peers: {
        projects: this.composedProject.app,
        organizations: this.composedOrganization.app,
        users: this.composedUser.app,
        traces: this.composedTrace.traces,
        permissions,
      },
    });
  }

  /**
   * The object store, over this process's own graph. The database is what it stands on: the
   * BYOC route lookup is a row read, so a process with none cannot install it at all.
   */
  private async installStoredObject(
    options: ApiRuntimeCompositionOptions,
  ): Promise<ComposedStoredObjectFeature> {
    const database = this.requireDatabase().connection;
    const clickHouse = this.composedClickHouse;
    const feature = await installApiStoredObject({
      prisma: database.client,
      resolveClickHouseClient: clickHouse?.resolveClient ?? null,
      // Every instance this process opened, for the id-only lookup an old trace's media
      // still arrives as: the row names no tenant, so the owner is found by asking each
      // instance rather than by routing. Absent, those media resolve to nothing.
      clickHouseInstances: clickHouse ? () => clickHouse.instances() : null,
      storage: options.config.infrastructure.storedObjects,
      report: LoggedApiStoredObjectAbsence.create(createLogger(options.config.serviceName)),
    });
    options.resources?.own("api stored-object aws clients", () => feature.close());
    return feature;
  }

  /**
   * The monitor surface, over this process's own graph, or none where the
   * execution half opened no graph for a monitor to run an evaluator on.
   *
   * The evaluator-workflow replication a copy carries is stranded on the
   * evaluator feature's own graph, so copying a monitor refuses by name while
   * every other monitor read and write answers for real.
   */
  private async installMonitor(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): Promise<ComposedMonitorFeature | undefined> {
    const evaluators = this.composedEvaluators;
    const permissions = this.composedAuthz?.app;
    if (!infrastructure || !evaluators || !permissions) return undefined;

    createLogger(options.config.serviceName).warn(
      "API process composed no evaluator workflow replication: copying a monitor to another project refuses by name, and every other monitor read and write answers.",
    );

    return installApiMonitor({
      infrastructure,
      peers: { permissions, evaluators, workflowReplication: unreplicatedEvaluatorWorkflows() },
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
    });
  }

  /**
   * The retention surface, over this process's own graph. The operator allow-list is the
   * user directory's, taken rather than parsed a second time, so "who may keep data
   * forever" and "who sees the operator sidebar" are never two answers. The two tenant
   * directories are the references the process binds once the tenant half has composed:
   * this feature installs BEFORE it, because the share ledger it bounds is what that half
   * administers a project's sharing through.
   */
  private async composeDataRetention(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): Promise<ComposedDataRetentionFeature | undefined> {
    const permissions = this.composedAuthz?.app;
    if (!permissions) return undefined;

    return await installApiDataRetention({
      infrastructure,
      peers: {
        projects: this.deferredApis.reference(ProjectApi),
        organizations: this.deferredApis.reference(OrganizationApi),
        permissions,
        // The SAME directory the /me screens answer from.
        users: this.composedUser.app,
      },
      // The platform application's own floor. Stated rather than read from
      // config: defaulting to the adapter's shorter value would silently
      // shorten every project's window on a deployment that never changed a
      // setting.
      defaultRetentionDays: options.config.platformDefaultRetentionDays,
      // The SAME Redis the queue owns, and the SAME ClickHouse the charted
      // reads run on: the meter counts the rows the explorer reads.
      redis: queueInfrastructure?.redis ?? null,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
    });
  }

  /**
   * Composes the scenario feature over this process's own graph.
   */
  private async composeScenario(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    encryption: SecretEncryptionPort | undefined,
  ): Promise<ComposedScenarioFeature> {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const agents = this.agentApi;
    // The process's ONE fan-out: this half's subscription and every presence
    // event ride one emitter per tenant.
    const auth = this.composedAuth?.compose();
    if (!database || !tenancy || !agents || !auth) {
      throw new Error(
        "api scenario composition needs a database, tenancy, the agent directory and auth: this process installed none",
      );
    }

    // The four collaborators a scenario RUN is prepared against, and the NARROWING for them.
    // Each is already implied by a gate above — the gateway and the secret store need this
    // database, this tenancy graph and this cipher; the execution half needs the gateway and
    // the agent directory; the trace read stack is built by this root whenever the trace group
    // composes, and that needs the same database, tenancy and identity.
    const workflows = this.composedWorkflowRuntime?.workflows;
    const modelProviders = this.composedModelProviders;
    const secrets = this.composedSecret?.app;
    const traces = this.composedTrace.traces;
    if (!workflows || !modelProviders || !secrets || !traces) {
      throw new Error(
        "api scenario composition needs workflows, model providers, secrets and traces: this process installed none",
      );
    }

    return await installApiScenario({
      prisma: database.client,
      resources: options.resources,
      authz,
      agents,
      connectedPresence: (input) => agents.getPresence(input),
      // Preparing a run reaches four other verticals and three deployment facts. Every one of
      // them is the object the rest of this process already serves: the workflow a workflow
      // target hydrates from, the ONE gateway its three model roles resolve on, the project
      // secrets its run parameters are decrypted from, and the trace reads an HTTP target's
      // ingest wait is measured on.
      scenarioExecution: {
        workflows,
        modelProviders,
        secrets,
        traces,
        config: {
          // Where the CHILD reports its own scenario events: this
          // deployment's ingestion origin, not the SDK default, which is
          // somebody else's deployment.
          langwatchEndpoint: options.config.infrastructure.execution.langwatchEndpoint ?? "",
          // The SAME engine the studio and every code evaluator dial.
          nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl ?? "",
          legacyDefaultModel: options.config.infrastructure.execution.defaultModel,
        },
      },
      // The SAME user directory the browser-session boundary composed: a run's
      // author and the person the session names must be one answer.
      users: this.composedUser.app,
      projects: tenancy.projects,
      broadcast: this.composedBroadcast,
      encryption,
      // The SAME routed ClickHouse the charted reads and the trace half use.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      redis: queueInfrastructure?.redis ?? null,
      // The senders the root registered, shared with the Langy feature: one
      // registration per definition, whatever composes over it.
      pipelines: this.composedAgentPipelines,
      defaultRetentionDays: options.config.platformDefaultRetentionDays,
      processName: options.config.serviceName,
      report: LoggedApiScenarioAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * Composes a project's captured traffic over this process's own graph.
   */
  private composeTrace(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    encryption: SecretEncryptionPort | undefined,
  ): ComposedTraceFeature {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const grants = this.composedAuthz?.grants;
    // The process's ONE fan-out, taken rather than composed again: both trace
    // subscriptions and every presence event ride one emitter per tenant, and
    // two would leave a browser watching a channel nothing writes to.
    const broadcast = this.composedBroadcast;
    const share = this.composedShare;
    // The retention window every trace read's floor is widened to. There is no
    // refusing twin: a read stack that cannot say how far back a project keeps
    // its traffic would answer a wrong window rather than a narrower one.
    const retention = this.composedDataRetention;
    // The tree the grid labels its rows from and the policy every read is
    // redacted under. Neither has a refusing twin, for the same reason the
    // retention window does not: a wrong label or an unredacted span is not a
    // narrower answer.
    const topic = this.composedTopic;
    const dataPrivacy = this.composedDataPrivacy;
    if (!database || !tenancy || !grants || !share || !retention || !topic || !dataPrivacy) {
      return refusingTraceFeature();
    }

    return composeTraceFeature({
      prisma: database.client,
      authz,
      projects: tenancy.projects,
      broadcast,
      // The share ledger and the topic tree, taken rather than built: the same
      // ledger the settings form administers redeems an anonymous read's token,
      // and the same tree `topics.*` answers labels the grid's rows.
      peers: { share: share.app, topics: topic.app },
      // The SAME ClickHouse the charted reads run on, opened once by
      // `composeAnalytics`: a trace and its chart are rows in one routed
      // instance, and a second connection would be a second pool.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      // The process's ONE counter, the same instance the unsubscribe family
      // and every metered REST door consume: two limiters would give one share
      // token two budgets for one rule. This is what makes the anonymous share
      // read's 60-per-token and 120-per-address ceilings real rather than
      // declared — the refusal, its code and its copy already exist.
      rateLimit: (input) => this.rateLimiter.consume(input),
      processName: options.config.serviceName,
      traceCommands: this.composedTraceCommands,
      spanIngest: ApiTraceSpanIngestAdapter.create(this.composedTraceCommands),
      ...(this.options.traceReads ? { traceReads: this.options.traceReads } : {}),
      // The read stack, over the SAME retention cascade and topic tree the
      // group composes for its own surfaces: a span read's floor and a grid
      // row's topic label must be the ones the retention screen and the topic
      // page show, and a second of either would be a second answer.
      traceReadsFrom: () =>
        composeApiTraceReadStack({
          prisma: database.client,
          resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
          defaultRetentionDays: options.config.platformDefaultRetentionDays,
          authz,
          dataPrivacy: dataPrivacy.app,
          projects: tenancy.projects,
          plans: this.resolvePlanProvider(options),
          dataRetention: retention.service,
          topics: topic.app,
          // The evaluations behind a trace, on the SAME ClickHouse and the
          // SAME retention cascade the trace itself is read through. Every
          // single-trace read asks for them, so a stack composed without one
          // answered a 500 rather than a trace.
          ...(this.composedClickHouse
            ? {
                evaluations: composeApiEvaluationReads({
                  resolveClickHouseClient: this.composedClickHouse.resolveClient,
                  dataRetention: retention.service,
                  processName: options.config.serviceName,
                }),
              }
            : {}),
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
          ...(this.composedEventing
            ? { ingest: ApiTraceSpanIngestAdapter.create(this.composedTraceCommands) }
            : {}),
          processName: options.config.serviceName,
        }),
      plans: this.options.plans ?? this.resolvePlanProvider(options),
      report: LoggedApiTraceAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * Installs what an organization's plan allows, what has been used against it and what it
   * has cost. ONE application serves all three, because the panel and every banner that
   * quotes an allowance must agree about which plan an organization is on.
   */
  private async composeEntitlement(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): Promise<ComposedEntitlementFeature | undefined> {
    const notifications = this.composedNotification;
    if (!infrastructure || !notifications) return undefined;
    const usage = composeApiUsageStats({
      prisma: infrastructure.prisma,
      plans: this.resolvePlanProvider(options),
      notifications: notifications.app,
      // Both routings, off the ONE connection: the trace rollup is keyed by
      // project and the billable-events rollup by organization, which the
      // tenant router cannot answer. They travel together because this
      // process either opened that connection or did not.
      clickhouse: this.composedClickHouse
        ? {
            resolveClient: this.composedClickHouse.resolveClient,
            resolveOrganizationClient: this.composedClickHouse.resolveOrganizationClient,
          }
        : null,
      // The SAME gateway the password-reset link leaves through, and the
      // same host the message's "View Usage Details" button points at.
      ...(this.composedMail ? { mail: this.composedMail } : {}),
      processName: options.config.serviceName,
      report: this.entitlementAbsence(options),
    });

    return await installApiEntitlement({
      infrastructure,
      // The SAME sources the process's plan provider resolves through, so a
      // banner and the surface beside it cannot disagree about which plan.
      entitlement: {
        ...this.resolvePlanSources(options),
        counter: usage.counter,
        // A host's own gateway wins; otherwise this deployment's.
        warnings: this.options.usage ?? usage.warnings,
      },
      // The SAME user directory the /me screens answer from: the operator a
      // plan is enriched for and the person a session names are one answer.
      peers: { users: this.composedUser.app },
    });
  }

  /**
   * Composes the five tenant-administration features over this process's own graph.
   */
  private async composeTenantFeatures(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): Promise<void> {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    // The evaluator service the execution features composed, for the monitor
    // directory below: taken rather than built so a monitor's evaluator and
    // the `evaluators.*` surface cannot disagree about what one runs.
    const evaluators = this.composedEvaluators;
    // The share ledger the project settings form administers. There is no
    // refusing twin to stand in for it, and a project surface that cannot say
    // what a project shares is not a narrower answer but a wrong one.
    const share = this.composedShare;
    // The topic tree the project explorer labels from, taken for the same
    // reason the share ledger is: a second tree would let the settings form and
    // the explorer disagree about what a project holds.
    const topic = this.composedTopic;
    if (!infrastructure || !database || !tenancy || !evaluators || !share || !topic) {
      this.composedOrganization = refusingOrganizationFeature();
      this.composedProject = refusingProjectFeature();
      this.composedCodingAgent = {
        app: CodingAgentApp.refusing(),
        router: (mount) => createCodingAgentTrpcRouter(mount.runtime),
      };
      this.composedAutomation = refusingAutomationFeature();
      this.composedEnterprise = refusingEnterpriseFeature();
      return;
    }

    // The Enterprise application members this process can serve, composed once and read by
    // every surface below through `resolveEnterprise()`. Three of the eight; the other five
    // stay absent and say so at boot.
    this.composedEnterpriseApplication = composeApiEnterpriseApplication({
      prisma: database.client,
      encryption,
      // The SAME ClickHouse the spend ledger is projected into, so the emitted webhook
      // envelopes and the rows they were rendered from stay one connection.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      plans: this.resolvePlanProvider(options),
      eventSourcing: this.composedEventing?.eventSourcing,
      // The SAME `ADMIN_EMAILS` list the back office is gated on, deliberately not `ops:*` —
      // if that permission ever widens, who may attest a customer's domain must not widen
      // with it.
      operators: this.platformOperators(options),
      report: LoggedApiEnterpriseApplicationAbsence.create(
        createLogger("langwatch:api:enterprise-application"),
      ),
    });
    const enterprise = this.resolveEnterprise();

    // Injected wins; otherwise the service this process composed over its own
    // graph. Resolved here rather than left to the organization feature's own
    // fold because the management REST family administers the same
    // invitations, and one service is what keeps the two doors from
    // disagreeing about them.
    const invites =
      this.options.organizationInvites ?? this.resolveOrganizationInvites(options)?.trpc;

    // The invitation and join-request messages, over the ONE mail graph this process composed.
    const personMail = this.resolvePersonMail();

    // The membership half: the seats, groups, join requests and sign-up
    // ceremony this feature serves over the graph the person-shaped features
    // already composed. All of it or none — a process holding part of it would
    // let somebody be admitted by one door and be invisible to the next.
    const grants = this.composedAuthz?.grants;
    const permissions = this.composedAuthz?.app;
    const session = this.composedAuth?.compose();
    const membership =
      grants && session && permissions
        ? {
            organizations: tenancy.organizations,
            projects: tenancy.projects,
            grants,
            permissions,
            auth: session.auth,
            // The SAME application `user.*` answers from: a second would
            // provision a personal workspace for somebody the /me screens do
            // not know.
            users: this.composedUser.app,
            // The senders the root registered for the identity ledgers: one
            // registration per definition, whatever composes over it.
            eventing: this.composedIdentityEventing,
            ...(personMail ? { mail: personMail } : {}),
            processName: options.config.serviceName,
          }
        : undefined;

    this.composedOrganization = await installApiOrganization({
      infrastructure,
      peers: {
        encryption,
        ...(invites ? { invites } : {}),
        ...(enterprise ? { enterprise } : {}),
        ...(membership?.eventing
          ? { membership: { ...membership, eventing: membership.eventing } }
          : {}),
      },
      // The process's ONE counter: two limiters would give a caller two budgets.
      rateLimit: (input) => this.rateLimiter.consume(input),
      baseHost: options.config.infrastructure.execution.publicBaseUrl ?? "",
      demoProject: {
        userId: options.config.authz.demoProjectUserId ?? "",
        projectId: options.config.authz.demoProjectId ?? "",
      },
    });

    // The caller's read-time redactions, taken off the trace READ stack this process already
    // composed rather than left for a host to supply. Nothing supplies it — `api.main.ts`
    // composes with no options at all — so `project.getFieldRedactionStatus` refused on every
    // trace open and `codingAgents.sessionsList` with it.
    const viewerProtections = this.resolveViewerProtections();

    this.composedProject = await installApiProject({
      infrastructure,
      peers: {
        organizations: tenancy.organizations,
        apiKeys: tenancy.apiKeys,
        // Taken rather than built: a second share ledger or topic tree would
        // let the settings form and the explorer disagree about what a
        // project holds.
        share: share.app,
        topics: topic.app,
        encryption,
        ...(viewerProtections ? { viewerProtections } : {}),
      },
    });

    this.composedCodingAgent = await composeCodingAgentFeature({
      infrastructure,
      defaultRetentionDays: options.config.platformDefaultRetentionDays,
      // The SAME trail every other completed mutation on this process is
      // recorded on: a read that names people is written where they are.
      audit: this.resolveAudit(),
      peers: {
        projects: tenancy.projects,
        github: await this.resolveGithub(options, database.client, queueInfrastructure, tenancy),
        // The SAME ClickHouse the charted reads and the traces run on: a
        // coding-agent session is a projection in that instance, and a second
        // connection would be a second pool.
        clickHouse: this.resolveCodingAgentClickHouse(),
        ...(viewerProtections ? { viewerProtections } : {}),
      },
    });

    this.composedAutomation = composeAutomationFeature({
      infrastructure,
      peers: {
        projects: tenancy.projects,
        // The ONE monitor application the execution half installed: a trigger
        // names the monitors the monitor page lists, not a second reading.
        monitors: this.composedMonitor?.app,
        encryption,
        // The SAME Redis the queue owns, which the worker spends the
        // automation persist ceiling against.
        redis: queueInfrastructure?.redis ?? null,
      },
      rateLimit: (input) => this.rateLimiter.consume(input),
      unsubscribeSecret: options.config.storedSecretEncryptionKey,
      baseHost: options.config.infrastructure.execution.publicBaseUrl ?? "",
      processName: options.config.serviceName,
    });

    this.composedSeatAllowances = ApiEnterpriseSeatAllowance.create(
      ApiOrganizationSeatLicense.create({
        plans: this.resolvePlanProvider(options),
        memberships: PrismaUsageMembershipRepository.create(database.client),
      }),
    );
    this.composedEnterprise = composeEnterpriseFeature({
      ...(enterprise ? { enterprise } : {}),
      // The seat allowances `/settings/members` asks about on every open. Answered whether or
      // not this deployment composed an Enterprise application, over the SAME plan provider and
      // membership counts the organization half spends a seat against: a member refused there
      // and a member counted here cannot be told two different numbers.
      seats: this.composedSeatAllowances,
      licensingStore: PostgresOrganizationLicenseAdapter.create(database.client).build(),
      licensePublicKey: options.config.infrastructure.licensing.publicKey,
    });
  }

  /**
   * The Langy feature, over this process's own graph. One peer: the project directory the
   * rollout gate resolves an organization through.
   */
  private composeLangy(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
    tenancy: ApiTenancyComposition | undefined,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ComposedLangyFeature {
    const broadcast = this.composedPresence.broadcast;
    if (!infrastructure || !tenancy || !broadcast) return refusingLangyFeature();

    return composeLangyFeature({
      infrastructure,
      peers: { projects: tenancy.projects },
      // The senders the root registered, shared with the scenario half.
      commands: this.composedAgentPipelines.langyConversations,
      redis: queueInfrastructure?.redis ?? null,
      publicBaseUrl: options.config.infrastructure.execution.publicBaseUrl,
      // The SAME fabric presence already publishes on: both live channels ride
      // one emitter per tenant rather than a second of their own.
      broadcast: this.composedPresence.emitter,
      demoProjectId: options.config.authz.demoProjectId,
      rateLimit: (request) => this.rateLimiter.consume(request),
      processName: options.config.serviceName,
      // The eight directories a navigate id names, read at the navigate rather
      // than captured here: Langy is composed before most of them exist, and a
      // navigate only ever runs once a turn is in flight.
      navigateResources: ApiLangyNavigateResourceAdapter.create(() => ({
        prompts: this.composedPrompt.app,
        datasets: this.composedDatasets,
        workflows: this.composedWorkflow.service,
        experiments: this.composedExperiment.experiments,
        monitors: this.composedMonitor?.app,
        evaluators: this.composedEvaluators,
        agents: this.agentApi,
        simulations: this.composedScenario.simulations,
      })),
      // The SAME local-control runtime the worker's REST door reads, so the
      // panel and the command line see one folder per conversation.
      ...(infrastructure.prisma
        ? {
            local: this.composeLangyLocalTrpc(
              infrastructure.prisma,
              this.composedAgentPipelines.langyConversations,
            ),
          }
        : {}),
    });
  }

  /**
   * The shared folder's WebSocket door, where this process composed a runtime
   * for it. Absent means the command line falls back to the long-poll routes,
   * which is the same recovery a dropped socket takes.
   */
  private composeLangyLocalGateway(): LocalControlGateway | undefined {
    const core = this.composeLangyLocalSessionCore();
    return core ? new LocalControlGateway({ core }) : undefined;
  }

  /** This process's long-poll sessions, over the same session core. */
  private composeLangyLocalLongPoll(): LocalControlLongPoll | undefined {
    if (this.composedLangyLocalLongPoll) return this.composedLangyLocalLongPoll;
    const core = this.composeLangyLocalSessionCore();
    if (!core) return undefined;
    this.composedLangyLocalLongPoll = new LocalControlLongPoll({ core });
    return this.composedLangyLocalLongPoll;
  }

  /**
   * What a shared folder MEANS to this process, independent of the transport
   * that carries it (ADR-129). One core, read by the socket and the long poll.
   */
  private composeLangyLocalSessionCore(): LocalControlSessionCoreService | undefined {
    if (this.composedLangyLocalSessionCore) return this.composedLangyLocalSessionCore;
    const prisma = this.composedDatabase?.connection.client;
    const apiKeys = this.composedTenancy?.apiKeys;
    const commands = this.composedAgentPipelines?.langyConversations;
    if (!prisma || !apiKeys || !commands) return undefined;

    const langy = this.composedLangy.app;
    const core = LocalControlSessionCoreService.create({
      apiKeys,
      readCredential: (header: (name: string) => string | undefined) =>
        extractApiKeyRequestCredentials(
          new Request("http://local/", {
            headers: Object.fromEntries(
              (["authorization", "x-project-id"] as const).flatMap((name) => {
                const value = header(name);
                return value ? [[name, value] as [string, string]] : [];
              }),
            ),
          }),
        ),
      actors: prisma,
      baseHost: this.composedLangyPublicBaseUrl,
      ...this.composeLangyLocalRuntime(prisma, commands),
      conversations: {
        findByIdVisible: (args: { id: string; projectId: string; userId: string }) =>
          langy.tryFindVisible(args),
        recordUserMessage: (args) => langy.recordUserMessage(args),
      },
      events: commands,
      buffer: LangyTokenBufferRedisRepository.create({
        redis: this.composedQueueRedis as NonNullable<typeof this.composedQueueRedis>,
      }),
      turns: LocalControlSessionCoreService.turnStarter({
        actors: prisma,
        turns: {
          startConversationTurn: ({
            projectId,
            session,
            requestedConversationId,
            messages,
            idempotencyKey,
          }) =>
            langy.startTurn(
              {
                projectId,
                idempotencyKey,
                conversationId: requestedConversationId,
                messages: messages.map((message) => ({
                  role: message.role,
                  parts: [...message.parts],
                })),
                turnContext: {},
              },
              session,
            ),
        },
      }),
      skipGate: ({ projectId, model }) =>
        SkipPermissionsService.canModelSkipPermissions({
          projectId,
          model,
          providerRows: this.composeLangyProviderRows(prisma),
        }),
    });
    this.composedLangyLocalSessionCore = core;
    return core;
  }

  /** The panel's own half of local control, over the process's one runtime. */
  private composeLangyLocalTrpc(
    prisma: NonNullable<ApiProductionComposition["composedDatabase"]>["connection"]["client"],
    commands: LangyConversationCommands,
  ): LangyLocalTrpcPorts {
    return {
      runtime: this.composeLangyLocalRuntime(prisma, commands),
      commands,
      skipGate: ({ projectId, model }) =>
        SkipPermissionsService.canModelSkipPermissions({
          projectId,
          model,
          providerRows: this.composeLangyProviderRows(prisma),
        }),
      codeAccess: {
        tryRead: async (userId) =>
          (
            await prisma.user.findUnique({
              where: { id: userId },
              select: { langyCodeAccessPreference: true },
            })
          )?.langyCodeAccessPreference ?? null,
        write: async ({ userId, preference }) => {
          await prisma.user.update({
            where: { id: userId },
            data: { langyCodeAccessPreference: preference },
          });
        },
      },
    };
  }

  /**
   * The operator back office, over this process's own graph. Three peers and nothing else: the
   * user directory a back-office row names, the browser session an impersonation is started and
   * stopped against, and the project directory a scheduled job is scoped to.
   */
  private async composeOps(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
    tenancy: ApiTenancyComposition | undefined,
  ): Promise<ComposedOpsFeature> {
    const auth = this.composedAuth?.compose();
    if (!infrastructure || !auth || !tenancy) {
      throw new Error(
        "api ops composition needs infrastructure, auth and tenancy: this process installed none",
      );
    }

    return await installApiOps({
      infrastructure,
      peers: {
        users: auth.users,
        auth: auth.auth,
        projects: tenancy.projects,
        apiKeys: tenancy.apiKeys,
      },
      // The process's ONE counter, so a report and every other public rule
      // share one flood budget per address.
      rateLimit: (input) => this.rateLimiter.consume(input),
      // The operator EXPLAIN account and the secret its caller presents, where
      // this deployment provisioned both.
      ...(this.composedOpsExplain
        ? {
            explain: {
              clients: this.composedOpsExplain.clients,
              findApiKey: () => this.composedOpsExplain?.ports.opsApiKey() ?? null,
              isProduction: this.composedOpsExplain.ports.isProduction,
            },
          }
        : {}),
      // The SAME allow-list the user feature already parsed and published as
      // `config.opsSidebarEmails`. Taken rather than re-read: the operator gate
      // and the menu that shows the operator link must never disagree about who
      // is staff.
      adminEmails: this.composedUser.config.opsSidebarEmails ?? [],
      // The install's own SHARED endpoint, for the one read that is nobody's
      // tenant: the operator searches `event_log` across tenants, so there is
      // no id to route on. Null on a deployment with only private routes, and
      // the explorer says so by name.
      eventLogClient: this.composedClickHouse?.resolveSharedClient() ?? null,
      eventing: this.composedEventing?.eventSourcing,
      // The SAME Redis the queue owns, which the worker publishes the ops snapshot on.
      // Without it the /ops dashboards read a snapshot nothing wrote and report an empty
      // fleet, which is a wrong answer rather than a missing one.
      redis: this.composedQueueRedis ?? null,
      // The snapshot reader polls on an interval; this is what releases it.
      resources: options.resources,
      report: LoggedApiOpsAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * The gateway-group half, over this process's own graph.
   */
  private async composeGateway(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): Promise<ComposedGatewayFeature> {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const evaluators = this.composedEvaluators;

    // A host's ledger wins: a process handed the product graph already holds
    // one, and a second over the same receipt table would be a second takeover
    // clock racing the first one's claims. Otherwise this process's own, which
    // is absent only where it composed no database or no cipher — and then the
    // three keyed creates refuse by name rather than executing unguarded.
    const idempotency = this.options.gatewayIdempotency ?? this.composedIdempotency?.gateway;

    return installApiGateway({
      infrastructure,
      // The three other features the gateway reaches, named one by one. Absent
      // together: a process holding none of them composes a refusing gateway,
      // and only the gateway's own six namespaces are affected.
      peers:
        database && tenancy && evaluators && this.composedMonitor
          ? {
              projects: tenancy.projects,
              evaluators,
              // The SAME monitor application the automation half and the
              // monitor family read: a guardrail attachment and the monitor
              // page it points at must agree about what one runs.
              monitors: this.composedMonitor.app,
            }
          : undefined,
      // The SAME ClickHouse the charted reads and the traces run on: the
      // gateway ledger is a projection in that instance, and a second
      // connection would be a second pool.
      clickhouse: this.resolveGatewayClickHouse(),
      virtualKeyPepper: options.config.virtualKeyPepper,
      ...(idempotency ? { idempotency } : {}),
    });
  }

  /**
   * The gateway ledger's ClickHouse, over this process's own resolution.
   */
  private resolveGatewayClickHouse() {
    const clickhouse = this.composedClickHouse;
    if (!clickhouse) return null;
    return { resolve: (tenantId: string) => clickhouse.resolveClient(tenantId) };
  }

  /**
   * The coding-agent session store, over this process's own ClickHouse.
   */
  private resolveCodingAgentClickHouse() {
    const clickhouse = this.composedClickHouse;
    if (!clickhouse) return null;
    return { resolve: (tenantId: string) => clickhouse.resolveClient(tenantId) };
  }

  /**
   * The GitHub App this deployment registered, composed from configuration.
   */
  private async resolveGithub(
    options: ApiRuntimeCompositionOptions,
    prisma: PrismaConnection["client"],
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    tenancy: ApiTenancyComposition,
  ): Promise<GithubApi> {
    // Memoized: two halves ask for it, the org group's coding-agent reads and
    // the gateway group's `github.*` surface, and two installs would be two
    // installation caches over one App.
    if (this.composedGithub) return this.composedGithub;
    const installed = await installApiGithub({
      prisma,
      peers: { organizations: tenancy.organizations, projects: tenancy.projects },
      redis: queueInfrastructure?.redis ?? null,
      config: options.config.infrastructure.github,
      // The same key every other stored credential on this deployment is
      // sealed with: an install state signed by one process and verified by
      // another has to be the same signature.
      signingKey: options.config.storedSecretEncryptionKey ?? "",
    });
    this.composedGithub = installed.app;
    return this.composedGithub;
  }

  /**
   * The invitation half, composed once over this process's own graph. It was an injected port
   * with a refusing default, because `InviteService` lived in the retired platform application
   * and reached four verticals that had not moved.
   */
  private resolveOrganizationInvites(
    options: ApiRuntimeCompositionOptions,
  ): ApiOrganizationInvites | undefined {
    if (this.resolvedOrganizationInvites) return this.composedOrganizationInvites;
    this.resolvedOrganizationInvites = true;

    const database = this.composedDatabase?.connection;
    const grants = this.composedAuthz?.grants;
    const roles = this.composedRole?.app;
    if (!database || !grants || !roles) return undefined;

    this.composedOrganizationInvites = composeApiOrganizationInvites({
      prisma: database.client,
      grants,
      roles,
      // The SAME plan provider the usage panel and every allowance banner
      // read: a seat refused here and a seat counted there must be one number.
      plans: this.resolvePlanProvider(options),
      // The process's ONE counter, so a caller cannot get two invite budgets.
      rateLimit: (input) => this.rateLimiter.consume(input),
      baseHost: options.config.infrastructure.execution.publicBaseUrl ?? "",
    });
    return this.composedOrganizationInvites;
  }

  /**
   * The deployment facts the person-shaped surfaces read. A host that composed
   * this process may state them; where it named no operator list, the install's
   * own `ADMIN_EMAILS` answers. Nothing supplies `identity` in production, so
   * without this the back office and the operator menu saw an empty list and
   * hid `/api/admin/*` from every operator.
   */
  private personDeployment(options: ApiRuntimeCompositionOptions): ApiPersonDeploymentFacts {
    return resolvePersonDeploymentFacts({
      supplied: this.options.identity,
      adminEmails: options.config.deployment.adminEmails,
    });
  }

  /**
   * Whether a project has run any simulation: an injected port, else this process's own
   * simulation reads. Absent only where the scenario half did not compose, and the checklist
   * then reports the step as not started — which is what it already did.
   */
  private resolveSimulationEvidence(): ApiSimulationEvidencePort | undefined {
    if (this.options.simulations) return this.options.simulations;
    const simulations = this.composedScenario?.simulations;
    return simulations ? ApiScenarioSimulationEvidence.create(simulations) : undefined;
  }

  /**
   * Every message a person-shaped surface sends: an injected port, else this process's own
   * mail graph. Absent exactly where the deployment named no BASE_HOST, and then each surface
   * carries on without its message rather than refusing the write it belongs to.
   */
  private resolvePersonMail(): ApiPersonMailPort | undefined {
    if (this.options.mail) return this.options.mail;
    return this.composedMail ? ApiComposedPersonMail.create(this.composedMail) : undefined;
  }

  /**
   * The caller's read-time redactions: an injected resolver, else this process's own trace read
   * stack. Absent only where the process composed no read stack, and then the two surfaces that
   * ask refuse by name rather than guessing what a reader may see.
   */
  private resolveViewerProtections(): ApiViewerProtectionsPort | undefined {
    if (this.options.viewerProtections) return this.options.viewerProtections;
    const reads = this.composedTrace?.traceReads;
    return reads ? ApiTraceReadViewerProtections.create(reads) : undefined;
  }

  private resolvePlanProvider(options: ApiRuntimeCompositionOptions): PlanProvider {
    this.composedPlanProvider ??= EntitlementService.create(this.resolvePlanSources(options));
    return this.composedPlanProvider;
  }

  /**
   * The deployment's plan sources, resolved once: the installed entitlement feature
   * builds its own resolver over these rather than being handed a second provider,
   * and each absent source is named once rather than once per reader.
   */
  private resolvePlanSources(options: ApiRuntimeCompositionOptions): EntitlementServiceOptions {
    if (this.composedPlanSources) return this.composedPlanSources;
    const database = this.composedDatabase?.connection;
    this.composedPlanSources = composeApiPlanSources({
      isSaas: options.config.infrastructure.modelProvider.isSaas,
      // The subscription rows the hosted deployment's paid plans live in, and the licence row a
      // self-hosted deployment's Enterprise tier lives in, on the SAME guarded client every
      // other read runs on. Without them a paying organization resolves the free baseline and a
      // licensed one resolves as unlicensed, which are wrong answers rather than missing ones.
      ...(database
        ? {
            subscriptions: PostgresBillingAdapter.create(database.client).build().subscriptions,
            licenses: PostgresOrganizationLicenseAdapter.create(database.client).build(),
          }
        : {}),
      // The rotated verification key, where the operator named one. The
      // background process reads the same variable, so the two cannot
      // disagree about whether this deployment is licensed.
      ...(options.config.infrastructure.licensing.publicKey
        ? { licensePublicKey: options.config.infrastructure.licensing.publicKey }
        : {}),
      adminEmails: AdminAccessService.parseEmails(this.personDeployment(options).adminEmails ?? []),
      report: this.entitlementAbsence(options),
    });
    return this.composedPlanSources;
  }

  /** One report for every entitlement absence, named once per process. */
  private entitlementAbsence(options: ApiRuntimeCompositionOptions): LoggedApiEntitlementAbsence {
    this.composedEntitlementAbsence ??= apiEntitlementAbsenceReport(options.config.serviceName);
    return this.composedEntitlementAbsence;
  }

  /**
   * The model gateway this process serves, and where it came from. Precedence, and the reason
   * for it: 1. An injected service wins, for the reason every other injected service wins here
   * — one gateway per process, and a test binding a double is asking for the double. 2.
   */
  private resolveModelProviders(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
  ): ModelProviderApi | undefined {
    if (this.options.modelProviders) return this.options.modelProviders;
    // Memoized: two halves ask for it — the execution half for the studio's
    // model calls, the observability half for the provider surface itself —
    // and a second gateway would be a second pool of provider connections and
    // a second decryption of the same stored credentials.
    if (this.composedModelProviders) return this.composedModelProviders;

    const absence = LoggedApiModelProviderAbsence.create(createLogger(options.config.serviceName));
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
    // Unreachable on this root, and kept: `resolveTenancy` composes nothing without the same
    // `encryption` local this method is handed, so a composed tenancy graph is itself the proof
    // the cipher exists. What the branch still carries is the NARROWING —
    // `composeApiModelProviders` takes a non-optional cipher — and a silent `return undefined`
    // in its place would drop the gateway with no line saying why.
    if (!encryption) {
      absence.absent("no-encryption");
      return undefined;
    }
    this.modelProviderOptions = {
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
    };
    this.composedModelProviders = composeApiModelProviders(this.modelProviderOptions);
    return this.composedModelProviders;
  }

  /**
   * Composes the execution half of the collaborator set over this process's own graph.
   */
  private async composeExecutionFeatures(
    options: ApiRuntimeCompositionOptions,
    agents: AgentApi | undefined,
    encryption: SecretEncryptionPort | undefined,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): Promise<void> {
    const database = this.composedDatabase?.connection;
    const modelProviders = this.resolveModelProviders(options, encryption);
    // Held so the product-group half reads the SAME gateway rather than
    // composing a second: a stored prompt version's model reference and a
    // studio node's model must resolve to one provider, not to two.
    this.composedModelProviders = modelProviders;
    // The grants the dataset and monitor applications authorize a second
    // project's read with. Named in the guard rather than assumed: both install
    // over it, and neither holds a second answer to who may read what.
    const permissions = this.composedAuthz?.app;
    if (!database || !agents || !modelProviders || !infrastructure || !permissions) {
      LoggedApiExecutionAbsence.create(createLogger(options.config.serviceName)).absent({
        database: Boolean(database),
        agents: Boolean(agents),
        modelProviders: Boolean(modelProviders),
        permissions: Boolean(permissions),
      });
      this.composedWorkflow = refusingWorkflowFeature();
      this.composedExperiment = refusingExperimentFeature();
      return;
    }

    // The order below is the graph's own: a dataset is read by the studio, the
    // studio's service is what an evaluator publishes through, an evaluator is
    // what a monitor runs, and an experiment reaches all four.
    // The experiment a dataset borrows a name from is bound below rather than
    // passed: the experiment feature stands on the datasets this line opens, so
    // the two are one graph read in both directions.
    this.deferredApis.declare(ExperimentApi);
    this.composedDataset = await installApiDataset({
      prisma: infrastructure.prisma,
      peers: { experiments: this.deferredApis.reference(ExperimentApi), permissions },
      infrastructure: {},
    });
    const datasets = this.composedDataset.app;
    this.composedDatasets = datasets;
    const workflowRuntime = composeWorkflowRuntime({
      infrastructure,
      peers: { datasets, modelProviders },
      nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
      secretDecryptor: encryption,
      // The SAME object storage the file store writes bytes into: a staged
      // invoke body and a stored object belong in one tenant's bucket, and a
      // second connection would be a second answer to "which bucket".
      payloadStaging: DeferredPayloadStagingAdapter.create(
        () => this.composedStoredObject.payloadStaging,
      ),
    });
    this.composedWorkflowRuntime = workflowRuntime;
    // The ONE evaluator application: `evaluators.*`, `/api/evaluators` and the
    // studio all read it. Its workflow peer is read late, because the workflow
    // application takes this application as a peer of its own.
    this.composedEvaluator = await installApiEvaluator({
      infrastructure,
      peers: {
        workflows: workflowRuntime.workflows,
        nlpRuntime: workflowRuntime.nlpRuntime,
        workflowApp: () => this.composedWorkflow.app,
        modelProviders,
        permissions,
        users: this.composedUser.app,
      },
    });
    const evaluators = this.composedEvaluator.evaluators;
    this.composedEvaluators = evaluators;
    this.evaluatorApi = this.composedEvaluator.app;
    // The monitor application, installed HERE because the evaluator service a
    // monitor runs opens on the line above. The experiment wizard, the
    // automation half and the gateway all read THIS one, so a guardrail
    // attachment and the monitor page it points at cannot disagree.
    this.composedMonitor = await this.installMonitor(options, infrastructure);
    const monitors = this.composedMonitor?.app;

    this.composedStudioDispatch =
      this.options.studioDispatch ??
      composeApiWorkflowStudioDispatch({
        nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
        modelProviders,
        payloadStaging: DeferredPayloadStagingAdapter.create(
          () => this.composedStoredObject.payloadStaging,
        ),
        nlpLambdaFleet: options.config.nlpLambdaFleet,
        nlpLambdaFleetNamed: options.config.nlpLambdaFleetNamed,
        arnCache: this.composedQueueRedis
          ? RedisNlpLambdaArnCacheAdapter.create(this.composedQueueRedis)
          : void 0,
      });

    this.composedWorkflow = composeWorkflowFeature({
      infrastructure,
      resources: options.resources,
      runtime: workflowRuntime,
      studioDispatch: this.composedStudioDispatch,
      peers: { datasets, evaluators: this.evaluatorApi, modelProviders, agents },
      // The studio's autogenerated commit message, over the SAME gateway a
      // studio node resolves its own model through.
      commitMessages: composeWorkflowCommitMessages({
        modelProviders,
        projects: this.composedTenancy?.projects,
        nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
      }),
    });

    this.composedExperiment = composeExperimentFeature({
      infrastructure,
      peers: {
        workflowApp: this.composedWorkflow.app,
        workflows: workflowRuntime.workflows,
        datasets,
        monitors,
        evaluators,
        agents,
        modelProviders,
        // Resolved at the CALL rather than passed as a value: the evaluation
        // feature installs after the trace read stack and the retention
        // cascade it stands on, and both open after this line.
        reportEvaluation: (data) => this.requireEvaluation().reportEvaluation(data),
      },
      processName: options.config.serviceName,
      // The SAME ClickHouse the charted reads run on, opened once by
      // {@link composeAnalytics}: an experiment's run history and an
      // evaluation's analytics are rows in that same routed instance, and a
      // second connection would be a second pool against one server.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      eventing: this.composedEventing?.eventSourcing,
      nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
      publicBaseUrl: options.config.infrastructure.execution.publicBaseUrl,
      // The SAME Redis the queue owns, which the workbench run's abort flag
      // and its progress both live in: a stop asked for on one replica has to
      // reach the loop running on another, and a poll has to find the run
      // whichever replica takes it.
      redis: queueInfrastructure?.redis ?? null,
      // The SAME API-key service every credential in this process is minted
      // and verified through: a run's sandbox key is a narrower key, not a
      // second kind of key.
      apiKeys: tenancy.apiKeys,
      projects: tenancy.projects,
      // The SAME key the process seals stored secrets with: the token a
      // project's runs share is held under it, and nowhere durable.
      storedSecretEncryptionKey: options.config.storedSecretEncryptionKey,
      // The SAME fabric presence and the agent pipelines publish on: a
      // workbench cell saved on one replica has to reach the editor tab
      // subscribed on another, which a per-process emitter never does.
      broadcast: this.composedBroadcast,
      runReport: LoggedApiExperimentRunAbsence.create(createLogger(options.config.serviceName)),
    });
    // The reference the dataset application resolves a borrowed name through,
    // bound now that the experiment half is open.
    this.deferredApis.bind(ExperimentApi, this.composedExperiment.app);
  }

  /**
   * The process's evaluator runtime, composed on first use.
   */
  private resolveEvaluatorExecution(): ApiEvaluatorExecution | undefined {
    if (this.resolvedEvaluatorExecution) return this.composedEvaluatorExecution;
    this.resolvedEvaluatorExecution = true;

    const evaluators = this.composedEvaluators;
    const workflows = this.composedWorkflowRuntime?.workflows;
    const modelProviders = this.composedModelProviders;
    if (!evaluators || !workflows || !modelProviders) return undefined;

    this.composedEvaluatorExecution = composeApiEvaluatorExecution({
      // The observability half opens after the execution half, so the read
      // stack is resolved at the call rather than captured here.
      traceReads: () => this.composedTrace.traceReads?.readers().read,
      evaluators,
      workflows,
      modelProviders,
      langevalsEndpoint: this.evaluatorLangevalsEndpoint,
      processName: this.evaluatorProcessName,
      report: LoggedApiEvaluatorExecutionAbsence.create(createLogger(this.evaluatorProcessName)),
    });
    return this.composedEvaluatorExecution;
  }

  /**
   * The evaluator runtime, or the refusal a caller that cannot degrade needs. The studio's
   * re-score is such a caller: it has already told the customer an evaluation is running.
   */
  private requireEvaluatorExecution(): ApiEvaluatorExecution {
    const execution = this.resolveEvaluatorExecution();
    if (!execution) {
      throw new ApiEvaluationUnavailableError(
        "evaluator runtime, so it cannot score a trace on demand",
      );
    }
    return execution;
  }

  /**
   * This process's guarded connection, for the features that cannot be
   * installed without one. Named rather than optional-chained: a feature whose
   * every row read is a database read has no degraded form to offer.
   */
  private requireDatabase(): ApiDatabaseInfrastructure {
    const database = this.composedDatabase;
    if (!database) throw new ApiDatabaseRequiredError();
    return database;
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
 */
function composeApiDatabase(
  options: ApiRuntimeCompositionOptions,
): ApiDatabaseInfrastructure | undefined {
  const logger = createLogger(options.config.serviceName);
  return ApiDatabaseInfrastructure.tryCreate({
    resources: options.resources,
    database: options.config.infrastructure.database,
    nodeEnvironment: options.config.nodeEnvironment,
    logger,
    report: LoggedApiDatabaseAbsence.create(logger),
  });
}

/**
 * Composes the process's stored-secret cipher from its validated key. Separate from {@link
 * composeApiDatabase} because the two absences are different facts: a deployment can have a
 * database and no key, or a key and no database, and each one is worth naming on its own.
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
 * The metrics transport this process serves scrapes from, and where it came from. Precedence,
 * and the reason for it: 1. An injected transport wins.
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
 * Names which of the execution half's three preconditions this process is missing, once, at
 * boot.
 */
export class LoggedApiExecutionAbsence {
  static create(logger: Pick<Logger, "info">): LoggedApiExecutionAbsence {
    return new LoggedApiExecutionAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {}

  absent(present: {
    database: boolean;
    agents: boolean;
    modelProviders: boolean;
    permissions?: boolean;
  }): void {
    const missing = [
      present.database ? undefined : "a database",
      present.agents ? undefined : "an agent service",
      present.modelProviders ? undefined : "a model gateway",
      present.permissions === false ? "a grants service" : undefined,
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

/**
 * Names an unregistered spend pipeline once, at boot. `warn` rather than `info`, and the level
 * is the point: the data plane keeps every spooled record and re-posts it, so this deployment
 * accumulates a billing backlog it will drop when the gateway's own buffer fills.
 */
export class LoggedApiGatewaySpendPipelineAbsence extends ApiGatewaySpendPipelineAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiGatewaySpendPipelineAbsence {
    return new LoggedApiGatewaySpendPipelineAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutQueue(): void {
    this.logger.warn(
      { reason: "no-queue" },
      "API registered no gateway spend producer: /api/internal/gateway/spend-commands refuses with spend_pipeline_disabled and the data plane keeps spooling its billing records",
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
 * readiness-before-listen order and the shared finalization order so a deployment's shutdown
 * behaviour does not change when the product transports are added.
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
  static create(
    process: ApiProcess,
    agents: BootedRuntime<AgentInfrastructure> | undefined,
  ): ApiProductionProcess {
    return new ApiProductionProcess(process, agents);
  }

  private constructor(
    private readonly process: ApiProcess,
    private readonly agents: BootedRuntime<AgentInfrastructure> | undefined,
  ) {
    super();
  }

  async start(): Promise<{ host: string; port: number } | undefined> {
    await this.agents?.start();
    return this.process.start();
  }

  close(): Promise<void> {
    return this.process.close();
  }
}

/**
 * The reserved-metadata amendment's span write, over the process's own `trace_processing`
 * registration.
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

/**
 * Copying an evaluator's workflow, on a process that composed no replication of
 * the graph behind it. Both members refuse by name: a copy that silently made a
 * monitor without its workflow would be a structurally broken replica.
 */
function unreplicatedEvaluatorWorkflows(): MonitorWorkflowReplication {
  const refuse = (): Promise<never> =>
    Promise.reject(
      new ApiEvaluationUnavailableError(
        "evaluator workflow replication, so a monitor cannot be copied to another project",
      ),
    );

  return { replicateEvaluatorWorkflow: refuse, deleteReplicatedWorkflow: refuse };
}

/**
 * A capability this deployment did not compose, refused by name rather than as
 * an unhandled property read on `undefined`.
 */
class ApiEvaluationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiEvaluationUnavailableError";
  }
}

/**
 * A feature whose whole subject is stored rows was asked for on a process that
 * composed no connection. Named so the boot line reads the cause rather than a
 * property read on undefined.
 */
class ApiDatabaseRequiredError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment composed no database connection", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiDatabaseRequiredError";
  }
}

/**
 * This process mints no Langy session keys: minting is the worker's, and every
 * other Langy credential port here refuses for the same reason. Named so the
 * command line reads the cause rather than a generic failure.
 */
class ApiLangySessionKeyUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "Minting a Langy session key is not available on this deployment",
      {
        httpStatus: 503,
        fault: "platform",
      },
    );
    this.name = "ApiLangySessionKeyUnavailableError";
  }
}
