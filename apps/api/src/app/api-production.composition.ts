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
import type { AuthzGrantsService, AuthzPermission, AuthzService } from "@langwatch/authz-contract";
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
import {
  CompositeApiRawSurface,
  tryCreateApiStaticSurface,
} from "../app-static/app-static.surface";
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
import { PostgresBillingAdapter } from "@langwatch/enterprise-billing-server";
import { PostgresOrganizationLicenseAdapter } from "@langwatch/enterprise-licensing-server";
import { ApiAgentTestAdapter } from "../features/agent/agent-test.adapter";
import { ApiAgentWorkflowCopyAdapter } from "../features/agent/agent-workflow-copy.adapter";
import { ApiAgentsAbsenceReportPort, ApiAgentsComposition } from "./api-agents.composition";
import {
  ApiConnectedAgentsAbsenceReportPort,
  ApiConnectedAgentsComposition,
} from "./api-connected-agents.composition";
import { ConnectedAgentPresenceService } from "@langwatch/agent-server";
import { ApiUpgradeRouter } from "../api-upgrade-router";
import {
  composeDatasetFeature,
  composeDatasetService,
  refusingDatasetFeature,
  type ComposedDatasetFeature,
} from "../features/dataset/dataset.composition";
import {
  composeEvaluatorFeature,
  composeEvaluatorService,
  refusingEvaluatorFeature,
  type ComposedEvaluatorFeature,
} from "../features/evaluator/evaluator.composition";
import {
  composePromptFeature,
  refusingPromptFeature,
  type ComposedPromptFeature,
} from "../features/prompt/prompt.composition";
import {
  composeFeatureFlagFeature,
  refusingFeatureFlagFeature,
  type ComposedFeatureFlagFeature,
} from "../features/feature-flag/feature-flag.composition";
import {
  composeAnalyticsFeature,
  refusingAnalyticsFeature,
  type ComposedAnalyticsFeature,
} from "../features/analytics/analytics.composition";
import {
  composeAuthFeature,
  refusingAuthFeature,
  type ApiPersonDeploymentFacts,
  type ComposedAuthFeature,
} from "../features/auth/auth.composition";
import {
  composeUserFeature,
  refusingUserFeature,
  type ComposedUserFeature,
} from "../features/user/user.composition";
import {
  composePresenceFeature,
  refusingPresenceFeature,
  type ComposedPresenceFeature,
} from "../features/presence/presence.composition";
import {
  composeApiKeyFeature,
  refusingApiKeyFeature,
  type ComposedApiKeyFeature,
} from "../features/api-key/api-key.composition";
import type { ApiPersonMailPort } from "./api-person-mail.port";
import { ApiEventingIdentityAdapter } from "./api-identity-eventing.adapter";
import {
  composeApiIdentityPipelines,
  LoggedApiIdentityPipelinesAbsence,
} from "./api-identity-pipelines.composition";
import {
  composeWorkflowFeature,
  composeWorkflowRuntime,
  refusingWorkflowFeature,
  type ApiWorkflowRuntime,
  type ComposedWorkflowFeature,
} from "../features/workflow/workflow.composition";
import {
  composeExperimentFeature,
  refusingExperimentFeature,
  type ComposedExperimentFeature,
} from "../features/experiment/experiment.composition";
import {
  composeEvaluationFeature,
  ApiEvaluationUnavailableError,
  refusingEvaluationFeature,
  type ComposedEvaluationFeature,
} from "../features/evaluation/evaluation.composition";
import {
  composeApiEvaluatorExecution,
  LoggedApiEvaluatorExecutionAbsence,
  type ApiEvaluatorExecution,
} from "./api-evaluator-execution.composition";
import {
  composeTraceFeature,
  LoggedApiTraceAbsence,
  refusingTraceFeature,
  type ApiTraceReadStackPort,
  type ComposedTraceFeature,
} from "../features/trace/trace.composition";
import {
  composeShareFeature,
  refusingShareFeature,
  type ComposedShareFeature,
} from "../features/share/share.composition";
import {
  composeTopicFeature,
  refusingTopicFeature,
  type ComposedTopicFeature,
} from "../features/topic/topic.composition";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { UsageService } from "@langwatch/entitlement-server";

/**
 * The retention floor a project with no policy of its own is bounded by. The platform
 * application's `PLATFORM_DEFAULT_RETENTION_DAYS`.
 */
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;
import {
  composeApiModelProviders,
  LoggedApiModelProviderAbsence,
} from "./api-model-provider.composition";
import {
  composeScenarioFeature,
  LoggedApiScenarioAbsence,
  refusingScenarioFeature,
  type ComposedScenarioFeature,
} from "../features/scenario/scenario.composition";
import {
  composeRoleFeature,
  refusingRoleFeature,
  type ComposedRoleFeature,
} from "../features/role/role.composition";
import {
  composeHomeFeature,
  refusingHomeFeature,
  type ComposedHomeFeature,
} from "../features/project/home.composition";
import {
  composeDataRetentionFeature,
  LoggedApiDataRetentionAbsence,
  refusingDataRetentionFeature,
  type ComposedDataRetentionFeature,
} from "../features/data-retention/data-retention.composition";
import {
  composeMonitorFeature,
  composeMonitorService,
  LoggedApiMonitorAbsence,
  refusingMonitorFeature,
  type ComposedMonitorFeature,
} from "../features/monitor/monitor.composition";
import {
  composeStoredObjectFeature,
  LoggedApiStoredObjectAbsence,
  refusingStoredObjectFeature,
  type ComposedStoredObjectFeature,
} from "../features/stored-object/stored-object.composition";
import {
  composeOrganizationFeature,
  refusingOrganizationFeature,
  type ApiOrganizationInvitePort,
  type ComposedOrganizationFeature,
} from "../features/organization/organization.composition";
import {
  composeProjectFeature,
  refusingProjectFeature,
  type ComposedProjectFeature,
} from "../features/project/project.composition";
import {
  composeCodingAgentFeature,
  refusingCodingAgentFeature,
  type ComposedCodingAgentFeature,
} from "../features/coding-agent/coding-agent.composition";
import {
  composeAutomationFeature,
  refusingAutomationFeature,
  type ComposedAutomationFeature,
} from "../features/automation/automation.composition";
import {
  composeEnterpriseFeature,
  refusingEnterpriseFeature,
  type ApiEnterpriseApplicationPort,
  type ComposedEnterpriseFeature,
} from "../features/enterprise/enterprise.composition";
import type { ApiViewerProtectionsPort } from "../features/trace/trace-viewer-protections";
import {
  composeApiOrganizationInvites,
  type ApiOrganizationInvites,
} from "./api-organization-invites.composition";
import {
  composeGatewayFeature,
  type ComposedGatewayFeature,
} from "../features/gateway/gateway.composition";
import { composeEnterpriseGovernanceApplication } from "../features/enterprise/enterprise-governance.composition";
import type { ApiTrpcInfrastructure } from "../platform/infrastructure/api-trpc.infrastructure";
import type { ApiGatewayIdempotencyPort } from "./api-gateway.composition";
import {
  composeApiIdempotency,
  type ApiIdempotencyComposition,
} from "./api-idempotency.composition";
import { createGatewayPlatformRestApp } from "@langwatch/gateway-server";
import { createGatewaySpendRestApp, settlementGraceMs } from "@langwatch/gateway-server";
import { composeApiGatewaySpendRest } from "./api-gateway-spend-rest.composition";
import { composeApiGatewayWebhooks } from "./api-gateway-webhooks.composition";
import {
  composeApiElevenLabsWebhookRest,
  composeApiGatewayInternalRest,
} from "./api-gateway-internal-rest.composition";
import {
  ApiGatewaySpendPipelineAbsenceReport,
  composeApiGatewaySpendPipeline,
  type ApiGatewaySpendPipeline,
} from "./api-gateway-spend-pipeline.composition";
import { canonicalErrorFor } from "./api-canonical-error";
import { PostgresGithubAdapter } from "@langwatch/github-server";
import type { GithubService } from "@langwatch/github-contract";
import { PostgresMonitorAdapter } from "@langwatch/monitor-server";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { EvaluationNameAutoslugService } from "@langwatch/evaluation-server";
import { PostgresModelProviderEvidenceAdapter } from "@langwatch/model-provider-server";

import { createPlatformUrlBuilder } from "./api-rest-ports";
import { nanoid } from "nanoid";
import {
  composeHttpProxyFeature,
  LoggedApiStudioAbsence,
  type ApiStudioHostPort,
  type ComposedHttpProxyFeature,
} from "../features/agent/http-proxy.composition";
import {
  composeModelProviderFeature,
  LoggedApiModelProviderAbsence as LoggedApiModelProviderSurfaceAbsence,
  refusingModelProviderFeature,
  type ApiModelProviderHostPort,
  type ComposedModelProviderFeature,
} from "../features/model-provider/model-provider.composition";
import {
  composeSavedViewFeature,
  refusingSavedViewFeature,
  type ComposedSavedViewFeature,
} from "../features/dashboard/saved-view.composition";
import {
  composeSpendFeature,
  LoggedApiSpendAbsence,
  refusingSpendFeature,
  type ApiUsageStatsPort,
  type ComposedSpendFeature,
} from "../features/entitlement/spend.composition";
import {
  composeAnnotationFeature,
  refusingAnnotationFeature,
  type ApiAnnotationTraceContentPort,
  type ComposedAnnotationFeature,
} from "../features/annotation/annotation.composition";
import {
  composeApiTraceProducerCommands,
  type ApiTraceProducerCommands,
} from "../features/trace/trace-producer.composition";
import {
  composeIntegrationsChecksFeature,
  refusingIntegrationsChecksFeature,
  type ApiSimulationEvidencePort,
  type ComposedIntegrationsChecksFeature,
} from "../features/project/integrations-checks.composition";
import { TraceSpanIngestPort } from "@langwatch/trace-server";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  ApiTrpcFeaturesComposition,
  LoggedApiTrpcFeaturesAbsence,
} from "./api-trpc-features.composition";
import { generateClickHouseFilterConditions } from "@langwatch/analytics-server";
import { composeApiModelProviderHost } from "./api-model-provider-host.composition";
import {
  composeApiStudioHost,
  composeApiWorkflowStudioDispatch,
} from "./api-studio-host.composition";
import {
  composeApiAuthoringRest,
  LoggedApiAuthoringRestAbsence,
} from "./api-authoring-rest.composition";
import { ApiExperimentRunAbsenceReport } from "./api-experiment-run.composition";
import { composeApiExperimentFindOrCreate } from "../features/experiment/experiment-init-rest.mount";
import { composeApiTraceReadStack } from "./api-trace-read-stack.composition";
import { composeApiEvaluationReads } from "./api-evaluation-read.composition";
import {
  apiEntitlementAbsenceReport,
  composeApiPlanProvider,
  composeApiUsageEnforcement,
  composeApiUsageStats,
  type LoggedApiEntitlementAbsence,
} from "./api-usage.composition";
import { tryCreateApiMailComposition, type ApiMailComposition } from "./api-mail.composition";
import { ApiComposedPasswordResetMail } from "./api-better-auth.composition";
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
import { requestTraceIds } from "@langwatch/api/rest";
import type { AppRestManagementAuditPort, AppRestSecurity } from "@langwatch/api/rest";
import { ApiRateLimitInfrastructure } from "../platform/infrastructure/api-rate-limit.infrastructure";
import {
  ApiAuthAbsenceReportPort,
  ApiAuthComposition,
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
  AuthSessionApiAuthenticationAdapter,
} from "./api-auth.composition";
import { ApiUserAvatarStorageAdapter } from "../features/user/user-avatar-storage.adapter";
import { ApiInstanceAdminKeyAdapter } from "./api-instance-admin-key.adapter";
import { ApiRestObservabilityComposition } from "./api-rest-observability.composition";
import type { ApiSubscriptionMount } from "../api.application";
import { createSseSubscriptionApp } from "../app-trpc/app-trpc.sse";
import { ApiHandlerManagedSession } from "./api-handler-managed-session";
import { createApiProcessRestFeatures } from "../app-rest/app-rest.process-features";
import {
  composeApiPackagedRest,
  LoggedApiPackagedRestAbsence,
} from "./api-packaged-rest.composition";
import {
  composeApiOpsExplainRest,
  type ApiOpsExplainRest,
} from "../features/ops/ops-clickhouse-explain-rest.mount";
import { ApiHandlerManagedCredentials } from "./api-handler-managed-credential";
import { apiClientAddress } from "./api-client-address";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";
import { composeApiTraceIngest, LoggedApiTraceIngestAbsence } from "./api-trace-ingest.composition";
import {
  AdminAccessService,
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
import { refusingGithubService } from "../features/github/github.composition";
import { composeApiAdminRest } from "../features/ops/admin-rest.mount";
import {
  composeApiAgentPipelines,
  LoggedApiAgentPipelinesAbsence,
  type ApiAgentPipelines,
} from "./api-agent-pipelines.composition";
import {
  composeLangyFeature,
  refusingLangyFeature,
  type ComposedLangyFeature,
} from "../features/langy/langy.composition";
import {
  composeDataPrivacyFeature,
  refusingDataPrivacyFeature,
  type ComposedDataPrivacyFeature,
} from "../features/data-privacy/data-privacy.composition";
import {
  composeBugReportFeature,
  refusingBugReportFeature,
  type ComposedBugReportFeature,
} from "../features/bug-report/bug-report.composition";
import {
  composeOpsFeature,
  LoggedApiOpsAbsence,
  refusingOpsFeature,
  type ComposedOpsFeature,
} from "../features/ops/ops.composition";
import { composeApiAuthCliDeviceFlow } from "../features/auth/auth-cli-device-flow-rest.mount";
import { composeApiAuthRest } from "../features/auth/auth-rest.mount";
import { composeApiGovernanceCliRest } from "../features/enterprise/governance-cli-rest.mount";
import { composeApiGovernanceIngestRest } from "../features/enterprise/governance-ingest-rest.mount";
import {
  composeApiScimRest,
  LoggedApiScimAbsence,
  type ApiScimRestPorts,
} from "./api-scim.composition";
import type { AuthCliDeviceFlowRestPorts, AuthRestPorts } from "@langwatch/auth-server";
import type {
  GovernanceCliRestPorts,
  GovernanceIngestRestPorts,
  GovernanceIngestTraceCollectionPort,
} from "@langwatch/enterprise-governance-server";
import type { GithubRestPorts } from "@langwatch/github-server";
import type { FilesRateLimiter } from "@langwatch/stored-object-server";

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
  agents?: AgentService;
  /**
   * A host's already-composed secret service, when it has one. Optional since this process can
   * build its own: see {@link ApiProductionComposition.resolveSecrets} for which wins.
   */
  secrets?: SecretService;
  /**
   * A host's already-composed API-key service, when it has one.
   */
  apiKeys?: ApiKeyService;
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
  modelProviders?: ModelProviderService;
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
   * The reviewer's trace content, for the annotation queue. The one thing the product half
   * cannot build for itself: resolving a trace's full content with the caller's own redactions
   * applied reaches a trace application this process does not compose.
   */
  traceContent?: ApiAnnotationTraceContentPort;
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
   * The provider capabilities that reach OUTSIDE this process: the vendor credential probes,
   * the Codex device flow and the cost-rule span preview.
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
  private composedFeatureFlag!: ComposedFeatureFlagFeature;
  private composedDataset!: ComposedDatasetFeature;
  private composedEvaluator!: ComposedEvaluatorFeature;
  private composedPrompt!: ComposedPromptFeature;
  private composedAuthFeature!: ComposedAuthFeature;
  private composedUser!: ComposedUserFeature;
  private composedPresence!: ComposedPresenceFeature;
  private composedApiKey!: ComposedApiKeyFeature;
  /**
   * The identity ledgers' event stack, or none.
   */
  private composedIdentityEventing: ApiEventingIdentityAdapter | undefined;
  /**
   * The four things the execution features are built from and hand to each other, held because
   * a feature composed later reads one: the studio graph and its engine, the ONE dataset
   * service, the ONE evaluator service, and the monitor service an experiment upserts through.
   */
  private composedWorkflowRuntime: ApiWorkflowRuntime | undefined;
  private composedDatasets: DatasetService | undefined;
  private composedEvaluators: EvaluatorService | undefined;
  private composedExecutionMonitors: MonitorService | undefined;
  private composedWorkflow!: ComposedWorkflowFeature;
  private composedExperiment!: ComposedExperimentFeature;
  private composedEvaluation!: ComposedEvaluationFeature;
  private composedTrace!: ComposedTraceFeature;
  private composedShare!: ComposedShareFeature;
  private composedTopic!: ComposedTopicFeature;
  private composedRole!: ComposedRoleFeature;
  private composedHome!: ComposedHomeFeature;

  private composedDataRetention!: ComposedDataRetentionFeature;
  private composedMonitor!: ComposedMonitorFeature;
  private composedStoredObject!: ComposedStoredObjectFeature;
  private composedBugReport!: ComposedBugReportFeature;
  private composedDataPrivacy!: ComposedDataPrivacyFeature;
  private composedIntegrationsChecks!: ComposedIntegrationsChecksFeature;
  private composedAnnotation!: ComposedAnnotationFeature;
  private composedSavedView!: ComposedSavedViewFeature;
  private composedSpend!: ComposedSpendFeature;
  private composedHttpProxy!: ComposedHttpProxyFeature;
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
   * The stored-secret cipher this process composed, or none.
   */
  private composedEncryption: SecretEncryptionPort | undefined;
  private composedGithub: GithubService | undefined;
  private composedMonitors: MonitorService | undefined;
  private composedModelProviders: ModelProviderService | undefined;
  private composedPlanProvider: PlanProvider | undefined;
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
  private secrets: SecretService | undefined;
  private requestPolicy: ApiRequestPolicy | undefined;

  private constructor(private readonly options: ApiProductionCompositionOptions) {
    super();
  }

  /**
   * Composes the process, in the one order its parts allow. Infrastructure first, because every
   * product service below is built from it; then AuthZ, because both doors authorize through it
   * and neither can be built before it exists; then the transports.
   */
  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const queueInfrastructure = this.composeQueue(options);
    this.composedDatabase = composeApiDatabase(options);
    this.composedEventing = this.composeEventing(options, queueInfrastructure);
    const authz = this.resolveAuthz(options, queueInfrastructure);
    const readiness = this.options.readiness ?? queueInfrastructure?.readiness;
    const metrics = resolveApiMetrics({ options, injected: this.options.metrics });
    const encryption = composeApiSecretEncryption(options)?.encryption;
    this.composedEncryption = encryption;
    const tenancy = authz ? this.resolveTenancy(options, encryption) : undefined;
    // Before the Auth graph, because the password-reset link leaves through it
    // and that graph is where Better Auth is composed. Nothing downstream of a
    // session gate: a deployment that cannot verify a browser caller still has
    // a gateway, it simply mounts no door that would use one.
    this.composedMail = tryCreateApiMailComposition({
      config: options.config,
      resources: options.resources,
    });
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
      audit: this.options.audit,
    });
    const agents = this.resolveAgents(options);
    this.resolveConnectedAgents(options, authz, tenancy, agents);
    // "Test agent", over the scenario feature's Scenario application — a
    // thunk for the same reason `workflowCopies` above is one: the agent
    // group composes AFTER this point, so a service read here rather than at
    // the call would always be absent.
    const agentTesting = ApiAgentTestAdapter.create({
      service: () => this.composedScenario?.agentTestService,
      processName: options.config.serviceName,
    });
    // The charted reads, the workbench and the dashboards, composed over this process's OWN
    // ClickHouse and the second, restricted identity a member's submitted SQL runs as. Both are
    // this composition's to open, so the record below can be satisfied without a host handing
    // them in. The process's ONE rollout store, composed before every feature that gates on a
    // flag.
    this.composedFeatureFlag = this.composedDatabase?.connection
      ? composeFeatureFlagFeature({
          prisma: this.composedDatabase.connection.client,
          config: options.config.featureFlags,
        })
      : refusingFeatureFlagFeature();
    this.composedAnalytics = this.composeAnalytics(options, authz);
    // The person half of the same record: the two signed-out doors, the signed-in person's
    // account and credentials, their organization's membership and groups, join requests,
    // sign-up and presence. Composed over the SAME user directory the browser-session boundary
    // resolves through and the SAME organization service the REST doors serve from — a second
    // of either would be a second answer to who somebody is.
    this.composePersonFeatures(options, auth, tenancy, queueInfrastructure);
    // The product half: a reviewer's annotations, the support inbox, the project's privacy
    // rules and its setup checklist. It composes FIRST because it is the one half that cannot
    // be missing on a process holding a database, which is what makes it the seed the other
    // three fold onto. The trace-side senders, registered once and handed to everything that
    // writes on the lane.
    this.composedTraceCommands = composeApiTraceProducerCommands({
      eventing: this.composedEventing?.eventSourcing,
      processName: options.config.serviceName,
    });
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
          featureFlags: this.composedFeatureFlag.service,
          // One variable, one meaning: `IS_SAAS` is what decides whether this
          // installation bills through Stripe, read from the one leaf that
          // already carries it rather than from a second of its own.
          saasBilling: options.config.infrastructure.modelProvider.isSaas,
          audit: this.options.audit,
        }
      : undefined;
    // The execution features: the studio's own lifecycle, the optimization
    // panel, the experiment wizard and its run loop, and the re-score. One
    // workflow service serves all of them plus the evaluator service built
    // over it, and the re-score reports through a PRODUCER-only registration
    // of the same pipeline the worker drains.
    this.composeExecutionFeatures(
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
    this.composedDataRetention = this.composeDataRetention(
      options,
      infrastructure,
      queueInfrastructure,
    );
    this.composedTopic = infrastructure
      ? composeTopicFeature({ infrastructure })
      : refusingTopicFeature();
    this.composedShare =
      infrastructure && this.composedTenancy && this.composedAuthz
        ? composeShareFeature({
            infrastructure,
            peers: {
              dataRetention: this.composedDataRetention.service,
              projects: this.composedTenancy.projects,
              grants: this.composedAuthz.grants,
            },
            // The SAME Redis the queue owns, which presence and the broadcast
            // fan-out already ride.
            redis: queueInfrastructure?.redis ?? null,
          })
        : refusingShareFeature();
    // A project's captured traffic: the trace itself and the five surfaces it
    // is read and corrected through. It composes after those three because it
    // reads all of them, and after the analytics half because its ClickHouse is
    // the one that opened there.
    this.composedTrace = this.composeTrace(options, authz, encryption);
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
    this.composedScenario = this.composeScenario(options, authz, queueInfrastructure, encryption);
    // The roles a member is granted and the strip of what they last opened.
    // Both used to ride inside the product-group half, so a process missing any
    // one of its six collaborators lost every role surface with it.
    this.composedRole =
      infrastructure && this.composedAuthz
        ? composeRoleFeature({ infrastructure, grants: this.composedAuthz.grants })
        : refusingRoleFeature();
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
    this.composeTenantFeatures(options, encryption, queueInfrastructure, infrastructure);
    // A project's own object store and the monitors running beside it. They compose after the
    // execution and product-group halves because the monitor surface takes their monitor
    // service, evaluator service and evaluator replication — one graph per answer, rather than
    // a second one that could disagree.
    this.composedStoredObject = this.composeStoredObject(options);
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
        ? this.resolveGithub(options, database.client, queueInfrastructure, directory)
        : refusingGithubService();
    this.composedGateway = this.composeGateway(options, infrastructure);
    // The back office, composed from the shared infrastructure plus the three other features it
    // names: the people a row is about, the session an impersonation is started against, and
    // the projects a scheduled job is scoped to. It used to ride inside the agent half, which
    // cost every operator surface whenever a scenario collaborator was missing. A project's
    // datasets, its evaluators and its prompt library.
    this.composedDataset =
      infrastructure && this.composedDatasets
        ? composeDatasetFeature({
            infrastructure,
            peers: {
              // Taken rather than built so a project's rows have ONE service:
              // the workflow and experiment applications read them through the
              // same one, and two would let `dataset.getAll` disagree with an
              // experiment's own row read.
              datasets: this.composedDatasets,
              experimentLookup: this.composedExperiment.experimentLookup,
            },
          })
        : refusingDatasetFeature();
    this.composedEvaluator =
      infrastructure && this.composedEvaluators
        ? composeEvaluatorFeature({
            infrastructure,
            peers: {
              evaluators: this.composedEvaluators,
              workflows: this.composedWorkflow.app,
              ...(this.composedModelProviders
                ? { modelProviders: this.composedModelProviders }
                : {}),
            },
          })
        : refusingEvaluatorFeature();
    this.composedPrompt =
      infrastructure && directory
        ? composePromptFeature({
            infrastructure,
            peers: {
              projects: directory.projects,
              ...(this.composedModelProviders
                ? { modelProviders: this.composedModelProviders }
                : {}),
            },
          })
        : refusingPromptFeature();
    // After the evaluator feature, whose replication ports a monitor copy
    // carries: one answer to what copying an evaluator does to the graph.
    this.composedMonitor = this.composeMonitor(options);
    this.composedOps = this.composeOps(options, infrastructure, directory);
    // The support inbox the back office reads. It used to ride inside the
    // product half, so a process missing any one of that half's six
    // collaborators lost the inbox with them.
    this.composedBugReport = infrastructure
      ? composeBugReportFeature({ infrastructure })
      : refusingBugReportFeature();
    // A project's scoped privacy rules, over the SAME project and organization
    // directories every other tenant-resolving surface reads. It used to ride
    // inside the product half beside the inbox and the annotations.
    this.composedDataPrivacy =
      infrastructure && directory
        ? composeDataPrivacyFeature({
            infrastructure,
            peers: { projects: directory.projects, organizations: directory.organizations },
          })
        : refusingDataPrivacyFeature();
    // The setup checklist. Its provider step is answered by the model-provider feature's OWN
    // persistence rather than by a `prisma.modelProvider` read written in the checklist: the
    // question is one existence read over the project's scope cascade, and that table holds
    // every stored credential in the deployment. A reviewer's comments, scores and queues.
    this.composedAnnotation = this.composeAnnotation(infrastructure);
    // The stored filter sets, and the spend the billing screen reports. Both
    // used to ride inside the observability half, so a process missing the
    // trace read stack lost a person's saved views with it.
    this.composedSavedView = infrastructure
      ? composeSavedViewFeature({ infrastructure })
      : refusingSavedViewFeature();
    this.composedSpend = this.composeSpend(options, infrastructure);
    // The studio's dispatch and the provider surfaces. Both used to ride inside
    // the observability half, so a process missing the trace read stack lost
    // the studio and every stored credential with it. The provider feature
    // takes the trace stack's OWN span reader as a peer, because a cost rule's
    // preview matches against the spans the explorer reads.
    this.composedHttpProxy = composeHttpProxyFeature({
      studio: this.composeStudioHost(options, encryption),
      report: LoggedApiStudioAbsence.create(createLogger(options.config.serviceName)),
    });
    this.composedModelProvider = infrastructure
      ? composeModelProviderFeature({
          infrastructure,
          peers: this.composedTrace.traceReads
            ? { spans: this.composedTrace.traceReads.readers().spans }
            : {},
          ...(this.composedModelProviders ? { modelProviders: this.composedModelProviders } : {}),
          host: this.composeModelProviderHost(options),
          report: LoggedApiModelProviderSurfaceAbsence.create(
            createLogger(options.config.serviceName),
          ),
        })
      : refusingModelProviderFeature();
    this.composedIntegrationsChecks =
      infrastructure && directory
        ? composeIntegrationsChecksFeature({
            infrastructure,
            modelProviders: PostgresModelProviderEvidenceAdapter.create({
              database: infrastructure.prisma,
              projects: directory.projects,
            }).build(),
            ...(this.options.simulations ? { simulations: this.options.simulations } : {}),
          })
        : refusingIntegrationsChecksFeature();
    // The conversation panel and the egress allow-list beside it. It used to
    // ride inside the agent half, so a process missing any scenario
    // collaborator lost both Langy surfaces with it.
    this.composedLangy = this.composeLangy(options, infrastructure, directory, queueInfrastructure);
    const features = ApiTrpcFeaturesComposition.tryCompose({
      // What a feature composes ITSELF out of, built once above and handed to
      // every `compose<Feature>()` the record's literal names.
      infrastructure,
      // The features whose doors are not only tRPC, composed before the mount
      // existed. Absent infrastructure there is no record either, so the
      // refusing gateway stands in rather than a second condition here.
      composed: {
        analytics: this.composedAnalytics,
        featureFlag: this.composedFeatureFlag,
        dataset: this.composedDataset,
        evaluator: this.composedEvaluator,
        prompt: this.composedPrompt,
        gateway: this.composedGateway,
        langy: this.composedLangy,
        ops: this.composedOps,
        scenario: this.composedScenario,
        dataRetention: this.composedDataRetention,
        home: this.composedHome,
        role: this.composedRole,
        monitor: this.composedMonitor,
        storedObject: this.composedStoredObject,
        bugReport: this.composedBugReport,
        dataPrivacy: this.composedDataPrivacy,
        integrationsChecks: this.composedIntegrationsChecks,
        annotation: this.composedAnnotation,
        savedView: this.composedSavedView,
        spend: this.composedSpend,
        httpProxy: this.composedHttpProxy,
        modelProvider: this.composedModelProvider,
        share: this.composedShare,
        topic: this.composedTopic,
        trace: this.composedTrace,
        workflow: this.composedWorkflow,
        experiment: this.composedExperiment,
        evaluation: this.composedEvaluation,
        organization: this.composedOrganization,
        project: this.composedProject,
        codingAgent: this.composedCodingAgent,
        automation: this.composedAutomation,
        enterprise: this.composedEnterprise,
        auth: this.composedAuthFeature,
        user: this.composedUser,
        presence: this.composedPresence,
        apiKey: this.composedApiKey,
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
          annotations: this.composedAnnotation.app,
          modelProviders: this.composedModelProvider.app,
          dataRetention: this.composedDataRetention.service,
          planProvider: this.resolvePlanProvider(options),
          share: this.composedShare.service,
          topics: this.composedTopic.service,
          traces: this.composedTrace.traces,
          workflows: this.composedWorkflow.app,
          experiments: this.composedExperiment.app,
          evaluations: this.composedEvaluation.app,
          automation: this.composedAutomation.app,
          codingAgentApp: this.composedCodingAgent.app,
          projects: this.composedProject.app,
          ...this.composedEnterprise.application,
          authzApp: this.composedRole.authzApp,
          dashboard: this.composedAnalytics.dashboard,
          dataset: this.composedDataset.app,
          evaluatorApp: this.composedEvaluator.app,
          featureFlags: this.composedFeatureFlag.service,
          prompts: this.composedPrompt.app,
          gateway: this.composedGateway.app,
          github,
          langy: this.composedLangy.app,
          ops: this.composedOps.app,
          monitors: this.composedMonitor.app,
          permissions: authz,
          roles: this.composedRole.app,
          scenarios: this.composedScenario.scenarios,
          storedObjectApp: this.composedStoredObject.app,
          suites: this.composedScenario.suites,
          ...composeEnterpriseGovernanceApplication(this.options.enterprise),
        },
      },
      report: LoggedApiTrpcFeaturesAbsence.create(createLogger(options.config.serviceName)),
    });
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
    const connectedAgentsUpgradeRouter = this.composedConnectedAgents
      ? ApiUpgradeRouter.create()
      : undefined;
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
      agentTesting,
      ...(this.composedConnectedAgents
        ? {
            connectedAgents: {
              presence: (input: { projectId: string; agents: { id: string; type: string }[] }) =>
                ConnectedAgentPresenceService.readAgentPresence({
                  ...input,
                  runtime: this.composedConnectedAgents!.runtime,
                }),
            },
          }
        : {}),
      ...(features ? { features } : {}),
      secrets: this.secrets,
      requestPolicy: this.requestPolicy,
      ...this.composeDoors(
        authz,
        tenancy,
        options.config.serviceName,
        options.config.infrastructure.execution.publicBaseUrl,
        options.config.infrastructure.execution.nlpServiceUrl,
        options.config.spendSettlementGraceMs,
        options.config.gatewayInternalSecret,
        options.config.gatewayJwtSecret,
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

    return Promise.resolve(ApiProductionProcess.create(process));
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
   * The process's one guarded Prisma connection, once it has been composed. `undefined` before
   * `compose`, and `undefined` after it when the deployment configured no `DATABASE_URL` — the
   * same degradation Redis has.
   */
  database(): PrismaConnection | undefined {
    return this.composedDatabase?.connection;
  }

  /**
   * The secret service this process serves, and where it came from. Precedence, and the reason
   * for it: 1. An injected service wins.
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
   * The agent service this process serves, and where it came from. Precedence, and the reason
   * for it: 1. An injected service wins.
   */
  private resolveAgents(options: ApiRuntimeCompositionOptions): AgentService | undefined {
    if (this.options.agents) return this.options.agents;

    const logger = createLogger(options.config.serviceName);
    this.composedAgents = ApiAgentsComposition.tryCompose({
      database: this.composedDatabase?.connection,
      processName: options.config.serviceName,
      // The execution half opens AFTER the agent service, so the Workflow
      // application is resolved at the copy rather than captured here.
      workflowCopies: ApiAgentWorkflowCopyAdapter.create({
        workflows: () => this.composedWorkflowRuntime?.workflows,
        processName: options.config.serviceName,
      }),
      report: LoggedApiAgentsAbsence.create(logger),
    });
    return this.composedAgents?.agents;
  }

  /**
   * The connected-agent transport (ADR-128): the WebSocket gateway, the HTTP
   */
  private resolveConnectedAgents(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
    agents: AgentService | undefined,
  ): ApiConnectedAgentsComposition | undefined {
    if (!agents) return undefined;
    const projects = this.composedTenancy?.projects;
    this.composedConnectedAgents = ApiConnectedAgentsComposition.tryCompose({
      database: this.composedDatabase?.connection,
      redis: this.composedQueueRedis ?? null,
      agents,
      apiKeys: tenancy.apiKeys,
      credentials: ApiHandlerManagedCredentials.create({ apiKeys: tenancy.apiKeys, authz }),
      // Absent when this process received its tenancy from a host rather than
      // composing its own: the `project_required` refusal then names none,
      // the same degrade every other project-dependent packaged family here
      // already accepts for that shape.
      projectsReachableBy: async (organizationId) => {
        if (!projects) return [];
        const page = await projects.listByOrganization({ organizationId, page: 1, limit: 50 });
        return page.data.map((project) => ({ id: project.id, name: project.name }));
      },
      publicBaseUrl: options.config.infrastructure.execution.publicBaseUrl,
      replicaCount: options.config.infrastructure.connectedAgents.replicaCount,
      ...(options.config.infrastructure.connectedAgents.relayMaxPayloadMb !== undefined
        ? { relayMaxPayloadMb: options.config.infrastructure.connectedAgents.relayMaxPayloadMb }
        : {}),
      processName: options.config.serviceName,
      report: LoggedApiConnectedAgentsAbsence.create(createLogger(options.config.serviceName)),
    });
    return this.composedConnectedAgents;
  }

  /**
   * The two doors this process opens on one credential resolution: the public REST families,
   * and the subscription lane beside them. Each REST family is the packaged builder over the
   * one {@link ApiRestSecurity}.
   */
  private composeDoors(
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
    serviceName: string,
    publicBaseUrl: string | undefined,
    nlpServiceUrl: string | undefined,
    /** The operator's settlement-grace override, still unparsed. */
    spendSettlementGrace: string | undefined,
    /** The HMAC secret the Go data plane signs its control-plane calls with. */
    gatewayInternalSecret: string | undefined,
    /** The key the credentials handed to that data plane are signed under. */
    gatewayJwtSecret: string | undefined,
  ): { rest: Hono; subscriptions: ApiSubscriptionMount } {
    const secrets = this.secrets;
    const gatewayApp = this.composedGateway.app;
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
    const annotations = this.composedAnnotation.app;
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
      // The one allowance both doors refuse an over-plan export with. Absent
      // where this process opened no ClickHouse, and the receiver says so.
      ...(this.composedUsageEnforcement ? { allowance: this.composedUsageEnforcement } : {}),
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
    // The billing reconciliation family, over the SAME spend ledger the gateway
    // application prices a budget against. Mounted beside the platform family
    // because they share `/api/gateway/v1`, and absent for the same reason:
    // without a gateway group there is no ledger to reconcile against.
    const gatewaySpendRest = this.composeGatewaySpendRest(spendSettlementGrace, restSecurity);
    // The spend pipeline, registered producer-only. Registered BEFORE the
    // internal family is composed because that family's `/spend-commands`
    // route is the only reason a producer exists on this tier, and the voice
    // settlement it also serves confirms through the same registration.
    this.composedGatewaySpendPipeline = composeApiGatewaySpendPipeline({
      eventing: this.composedEventing?.eventSourcing,
      processName: serviceName,
      report: LoggedApiGatewaySpendPipelineAbsence.create(createLogger(serviceName)),
    });
    // The Go data plane's control-plane calls, over the SAME gateway graph the
    // console and the public REST door read. `/api/internal/gateway` is a
    // literal first segment nothing else claims, so its position among the
    // families is free.
    const gatewayInternalRest = this.composeGatewayInternalRest(
      restSecurity,
      gatewayInternalSecret,
      gatewayJwtSecret,
    );
    // The other half of a brokered voice call: the vendor's post-call delivery,
    // which is the only path by which one reaches billing. Composed AFTER the
    // internal family for the same reason it is composed beside it — both
    // settle the SAME session row through the same confirmation — and its own
    // family because it is public by protocol where that one is ingress-blocked.
    const elevenLabsWebhookRest = this.composedDatabase?.connection
      ? (composeApiElevenLabsWebhookRest({
          security: restSecurity,
          prisma: this.composedDatabase.connection.client,
          encryption: this.composedEncryption,
          spendConfirmation: this.composedGatewaySpendPipeline?.confirmation,
        }) as Hono | undefined)
      : undefined;
    const bugReports = this.composeBugReports(tenancy);
    const unsubscribe = this.composeUnsubscribe();
    const langyRest = this.composeLangyRest();
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
    // The SCIM 2.0 provisioning surface, over the SAME directory the members
    // screen writes through and the SAME grant ledger every other membership
    // change is recorded on. Absent without an Enterprise governance
    // application, which is this family's gate — see the composition.
    const scim = this.composeScimRest(serviceName);
    // The charted reads and the prompt library, over the SAME applications the
    // browser's `analytics.getTimeseries` and `prompts.*` procedures resolve
    // on. Taken from the halves rather than built a second time: two analytics
    // applications would let the public door and the dashboard disagree about
    // what a metric means, and two prompt services about what a project holds.
    const analytics = this.composedAnalytics.analytics;
    const prompts = this.composedPrompt.app.promptService;
    // The governed-SQL family. Every collaborator is the analytics half's own,
    // so the API key's door and the workbench's door run one validator against
    // one catalogue; the saved charts sit on the same Dashboard application
    // the browser's dashboards do.
    const analyticsFeature = this.composedAnalytics;
    const projects = this.composedTenancy?.projects;
    const langWatchQL = projects
      ? {
          collaborators: {
            featureFlags: () => analyticsFeature.featureFlags,
            projects: () => projects,
            langWatchQL: () => analyticsFeature.langWatchQL,
            protectionsFor: (input: { projectId: string }) =>
              analyticsFeature.apiKeyProtections(input),
          },
          dashboard: () => analyticsFeature.dashboard,
        }
      : undefined;
    // The management family's five collaborators, or none. The organization object is the
    // identity half's own merged one — the canonical settings reads plus the membership
    // operations the contract does not declare — so the management door and the members screen
    // answer from one service. The share ledger and the plan provider are TAKEN from the halves
    // that composed them for the same reason.
    const organizationRest = this.composedOrganization.rest;
    const shares = this.composedShare.service;
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
              await this.options.audit?.record({
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
      studioDispatch: modelProviders
        ? composeApiWorkflowStudioDispatch({ nlpServiceUrl, modelProviders })
        : undefined,
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
            credential: (input: { request: Request; permission: AuthzPermission }) =>
              handlerManagedCredentials.authenticate(input),
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
    // The five subsystem probes. Every one of them posts a canary back through this
    // deployment's own public boundary, so the origin is what decides whether the family exists
    // at all; the automation application and the workflow lookup are the two probes' own
    // collaborators.
    const automationApp = this.composedAutomation.service;
    const healthProbes =
      publicBaseUrl && automationApp && workflowService
        ? {
            resolveProjectByApiKey: async (token: string) => {
              const resolved = await tenancy.apiKeys.tryResolveToken({ token });
              return resolved?.type === "legacyProjectKey" ? { id: resolved.project.id } : null;
            },
            publicBaseUrl,
            automation: () => automationApp,
            workflowExists: async (input: { workflowId: string; projectId: string }) => {
              try {
                await workflowService.getById({
                  id: input.workflowId,
                  projectId: input.projectId,
                });
                return true;
              } catch {
                return false;
              }
            },
          }
        : undefined;
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
      traceGroup && traceStack
        ? {
            traces: () => traceGroup.traces,
            shares: () => this.composedShare.service,
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
    const reportEvaluation = this.composedEvaluation.reportEvaluation;
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
            tryGetProject: async (projectId: string) => {
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
      agents: this.composedAgents?.agents,
      connectedAgents: this.composedConnectedAgents,
      scenario: this.composedScenario,
      analytics: this.composedAnalytics,
      authz,
      authzComposition: this.composedAuthz,
      credentials: handlerManagedCredentials,
      encryption: this.composedEncryption,
      experiment: this.composedExperiment,
      workflow: this.composedWorkflow,
      // The two Enterprise governance slices the REST families are handed —
      // the SAME ones `ctx.app` carries, so the two doors cannot answer
      // differently.
      enterpriseGovernance: composeEnterpriseGovernanceApplication(this.options.enterprise),
      presence: this.composedPresence,
      organization: this.composedOrganization,
      automation: this.composedAutomation,
      codingAgent: this.composedCodingAgent,
      enterprise: this.composedEnterprise,
      dataset: this.composedDataset,
      evaluator: this.composedEvaluator,
      role: this.composedRole,
      monitor: this.composedMonitor,
      storedObject: this.composedStoredObject,
      plans,
      publicBaseUrl,
      rateLimit: (request) => this.rateLimiter.consume(request),
      redis: this.composedQueueRedis,
      secrets,
      session: authoringSession,
      // The SAME dedup gate and command sender the OTLP receiver and the SDK
      // collector use, which is what makes a retried `POST /api/events/track`
      // and a redelivered SDK feedback event one recorded rating.
      traceIngest: otlpIngest,
      apiKeys: tenancy.apiKeys,
      organizations: tenancy.organizations,
      projects,
      modelProviders,
      // The SAME ceiling the framework chain installs on a declared policy.
      requireApiKeyPermission: (permission) => projectRestPolicy.permissionMiddleware(permission),
      audit: this.options.audit,
      managementAudit: this.composeManagementAudit(),
      isSaas: this.composedIsSaas,
      instanceAdminKey: this.composedFeaturePorts?.instanceAdminKey ?? (() => undefined),
      logger: createLogger(serviceName),
    });
    for (const processRestApp of createApiProcessRestFeatures({
      security: restSecurity,
      packagedAbsence: LoggedApiPackagedRestAbsence.create(createLogger(serviceName)),
      services: {
        packaged,
        ...(annotations ? { annotations: () => annotations } : {}),
        analytics: () => analytics,
        ...(langWatchQL ? { langWatchQL } : {}),
        ...(prompts ? { prompts: () => prompts } : {}),
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
      },
      ports: {
        handlerManagedCredential: (input) => handlerManagedCredentials.authenticate(input),
        // The SAME counter the packaged REST families and the identity
        // throttles meter through, so a caller has one budget per rule.
        rateLimit: (request) => this.rateLimiter.consume(request),
        ...(otlpIngest ? { otlpIngest: otlpIngest.otlp } : {}),
        ...(collector ? { collector } : {}),
        ...(bugReports ? { bugReports } : {}),
        ...(unsubscribe ? { unsubscribe } : {}),
        ...(langyRest ? { langy: langyRest } : {}),
        ...(githubRest ? { github: githubRest } : {}),
        ...(adminRest ? { admin: adminRest } : {}),
        ...(authCliDeviceFlow ? { authCliDeviceFlow } : {}),
        ...(governanceCli ? { governanceCli } : {}),
        ...(authRest ? { auth: authRest } : {}),
        ...(governanceIngest ? { governanceIngest } : {}),
        ...(scim ? { scim } : {}),
        ...(publicBaseUrl ? { publicBaseUrl } : {}),
        ...(healthProbes ? { healthProbes } : {}),
        ...(this.composedOpsExplain ? { opsClickHouseExplain: this.composedOpsExplain.ports } : {}),
        ...(dspySteps ? { dspySteps } : {}),
        ...(mcpAuthorize ? { mcpAuthorize } : {}),
        imageProxy: {
          blockLocalHttpCalls: this.composedRestEnvironment.blockLocalHttpCalls,
          allowedHosts: this.composedRestEnvironment.allowedProxyHosts,
        },
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
        .route("/", gatewayRest ?? new Hono())
        // The billing reconciliation family shares that namespace, in the same
        // relative order the retired router's enumeration gave the two: its
        // paths are literal (`/spend-events`, `/spend-summaries`) and the
        // platform family's are parameterised, and a literal segment wins over
        // a parameter at the same position.
        .route("/", gatewaySpendRest ?? new Hono())
        // The internal control plane. Its own namespace, blocked at the
        // ingress by the chart, and reached in-cluster through this process's
        // internal Service rather than through the public host.
        .route("/", gatewayInternalRest ?? new Hono())
        // The ElevenLabs post-call webhook. A literal first segment nothing
        // else claims, so its position here is free; it is last because it is
        // the only public gateway door that is not on `/api/gateway/v1`.
        .route("/", elevenLabsWebhookRest ?? new Hono()),
      // The subscription lane declares its access policy on the same security
      // every REST family does, so the one streaming route on this process is
      // a registry entry rather than an unaccounted-for endpoint. It is a
      // function because only the application holds the caller a path is
      // resolved on; see `ApiSubscriptionMount`.
      subscriptions: (ports) => createSseSubscriptionApp({ security: restSecurity, ports }).hono,
    };
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
   * The Auth graph this process authenticates browser callers with, and where it came from.
   * Precedence, and the reason for it: 1. An injected composition wins.
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
      // Where an uploaded avatar's bytes land: the content-addressed store the stored-object
      // feature opens, read at the UPLOAD rather than here. That feature composes further down
      // — it stands on services that stand on the session this graph verifies — so a store read
      // at this line would always be absent and every upload would refuse on a process that can
      // serve it.
      avatarStorage: ApiUserAvatarStorageAdapter.create({
        storedObjects: () => this.composedStoredObject?.bytes,
        processName: options.config.serviceName,
      }),
      processName: options.config.serviceName,
      report: LoggedApiAuthAbsence.create(logger),
    });
    return this.composedAuth;
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
      report: LoggedApiEventingAbsence.create(logger),
    });
  }

  /**
   * The Go data plane's internal control plane, or none. Composed only where this process holds
   * the gateway group, a database, the stored-secret cipher and a JWT signing key.
   */
  private composeGatewayInternalRest(
    security: AppRestSecurity,
    internalSecret: string | undefined,
    jwtSecret: string | undefined,
  ): Hono | undefined {
    const composition = this.composedGateway.composition;
    const database = this.composedDatabase?.connection;
    const projects = this.composedTenancy?.projects;
    if (!composition || !database || !projects) return undefined;

    const modelProviders = this.composedModelProviders;
    const monitors = this.composedMonitors;
    const spend = this.composedGatewaySpendPipeline;
    // The SAME runtime the legacy evaluate doors and the studio's re-score run
    // on. A guardrail and a monitor scoring the same evaluator two ways is
    // exactly what one runtime prevents; where this process composed none the
    // check keeps refusing by name rather than answering `allow`.
    const evaluatorExecution = this.resolveEvaluatorExecution();
    return composeApiGatewayInternalRest({
      security,
      prisma: database.client,
      gateway: composition,
      projects,
      internalSecret,
      jwtSecret,
      encryption: this.composedEncryption,
      // The process's ONE producer registration, so the drained batch and the
      // voice settlement write onto one stream with one set of dispatchers.
      ...(spend ? { spendCommands: spend.commands, spendConfirmation: spend.confirmation } : {}),
      ...(monitors ? { monitors } : {}),
      ...(evaluatorExecution
        ? { runEvaluator: (input) => evaluatorExecution.runEvaluation(input) }
        : {}),
      ...(modelProviders
        ? {
            refreshCodex: (input: { providerRowId: string }) =>
              modelProviders.refreshCodexForGateway(input),
          }
        : {}),
    }) as Hono | undefined;
  }

  private composeGatewaySpendRest(
    spendSettlementGrace: string | undefined,
    security: AppRestSecurity,
  ): Hono | undefined {
    const composition = this.composedGateway.composition;
    const database = this.composedDatabase?.connection;
    const plans = this.composedPlanProvider;
    if (!composition || !database || !plans) return undefined;

    // The Enterprise webhook platform, where this deployment has one. The
    // replay route is the only one of the four that reads it, so its absence
    // is that route refusing by name rather than the family being left off.
    const webhooks = composeApiGatewayWebhooks({
      database: database.client,
      encryption: this.composedEncryption,
      // The SAME ClickHouse the spend ledger itself is projected into: the
      // emitted envelopes and the rows they were rendered from are two tables
      // in one instance, and a second connection would be a second pool.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
    });
    const spend = composeApiGatewaySpendRest({
      prisma: database.client,
      gateway: composition,
      // The SAME plan lookup every allowance banner on this process reads, so
      // one organization cannot be entitled on one surface and refused here.
      plans,
      settlementGraceMs: settlementGraceMs(spendSettlementGrace),
      ...(webhooks ? { webhooks } : {}),
    });
    return createGatewaySpendRestApp({
      // The SAME credential resolution every other family on this process is
      // built from; the family declares its own organization-scoped
      // `Variables`, which the security chain sets before any handler runs.
      security,
      billingPlanGate: spend.billingPlanGate,
      // The process's one canonical mapping. The family installs its own
      // `onError` to log what the caller actually received and delegates the
      // rendering here rather than keeping a second taxonomy.
      canonicalError: (error, c) => canonicalErrorFor(error, requestTraceIds(c)),
      spend: () => spend.ports,
    }).hono as unknown as Hono;
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
      notifier: new SilentBugReportNotifier(),
      credentials: (request) => extractApiKeyRequestCredentials(request),
      apiKeys: () => tenancy.apiKeys,
    };
  }

  /**
   * The one-click unsubscribe door's collaborators, or none. `undefined` where this process
   * composed no automation application.
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
      langy: this.composedLangy.app,
      apiKeys: tenancy.apiKeys,
      featureFlags: this.composedFeatureFlag.service,
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
   * The RFC 8628 CLI device grant's collaborators, or none.
   */
  private composeAuthCliDeviceFlow(
    authz: AuthzService,
    tenancy: ApiResolvedTenancy,
    publicBaseUrl: string | undefined,
  ): AuthCliDeviceFlowRestPorts | undefined {
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
      featureFlags: this.composedFeatureFlag.service,
      publicBaseUrl,
    });
  }

  /**
   * The `/api/auth` family's collaborators, or none.
   */
  private composeAuthRest(tenancy: ApiResolvedTenancy): AuthRestPorts | undefined {
    const auth = this.composedAuth?.compose();
    return composeApiAuthRest({
      betterAuth: this.composedAuth?.betterAuth,
      sessions: auth?.sessions,
      auth: auth?.auth,
      apiKeys: tenancy.apiKeys,
      prisma: this.composedDatabase?.connection.client,
      featureFlags: this.composedFeatureFlag.service,
    });
  }

  /**
   * The CLI governance plane's collaborators, or none. The bearer reader is taken FROM the
   * device grant's own session service rather than built here: the grant writes the token
   * records and this half reads them, so one implementation of the keyspace is the whole point.
   */
  private composeGovernanceCliRest(
    authz: AuthzService,
    deviceFlow: AuthCliDeviceFlowRestPorts | undefined,
    publicBaseUrl: string | undefined,
  ): GovernanceCliRestPorts | undefined {
    const sessions = deviceFlow?.sessions;
    return composeApiGovernanceCliRest({
      governance: this.options.enterprise?.governance.governance,
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
   * The SCIM 2.0 provisioning surface's collaborators, or none.
   */
  private composeScimRest(serviceName: string): ApiScimRestPorts | undefined {
    const session = this.composedAuth?.compose();
    return composeApiScimRest({
      prisma: this.composedDatabase?.connection.client,
      grants: this.composedAuthz?.grants,
      users: session?.users,
      auth: session?.auth,
      governance: this.options.enterprise?.governance.governance,
      plans: this.composedPlanProvider,
      eventing: this.composedIdentityEventing,
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
      governance: this.options.enterprise?.governance.governance,
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
  private composeGithubRest(authz: AuthzService): GithubRestPorts | undefined {
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
   * Binds the two API-owned ports to this process's parsed config and its queue's Redis.
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
    if (!database || !projects) return refusingAnalyticsFeature();

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

    return composeAnalyticsFeature({
      prisma: database.client,
      authz,
      projects,
      featureFlags: this.composedFeatureFlag.service,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      langWatchQL: options.config.infrastructure.clickhouse.langwatchQl,
      resources: options.resources,
    });
  }

  /**
   * Composes the four person-shaped features: the two signed-out doors, the signed-in person's
   * account, presence and the tenant fan-out it publishes on, and the project's credentials.
   */
  private composePersonFeatures(
    options: ApiRuntimeCompositionOptions,
    auth: ApiAuthSessionCompositionPort,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): void {
    const database = this.composedDatabase?.connection;
    const projects = this.composedTenancy?.projects;
    const processName = options.config.serviceName;
    // A host that injected its own api-key and organization pair composed no
    // tenancy here, so it holds the collaborator set whole and hands it in
    // rather than having these features built for it.
    if (!database || !projects) {
      this.composedAuthFeature = refusingAuthFeature(processName);
      this.composedUser = refusingUserFeature(processName);
      this.composedPresence = refusingPresenceFeature();
      this.composedApiKey = refusingApiKeyFeature();
      return;
    }

    const session = auth.compose();
    // The three identity definitions, registered PRODUCER-only on this process's own Eventing.
    // Composed BEFORE the features because every ledger write below stages through them: the
    // thirteen identifier and two-step commands, the five a join request has, and the fourteen
    // a single sign-on connection has.
    const identityPipelines = composeApiIdentityPipelines({
      eventing: this.composedEventing?.eventSourcing,
      processName,
      report: LoggedApiIdentityPipelinesAbsence.create(createLogger(processName)),
    });
    // Held on the composition as well as handed down: the SCIM directory-sync
    // history stages through the SAME producer registrations, and a second
    // adapter would resolve senders out of a second registry.
    const identityEventing = ApiEventingIdentityAdapter.create({
      pipelines: identityPipelines,
    });
    this.composedIdentityEventing = identityEventing;

    this.composedAuthFeature = composeAuthFeature({
      prisma: database.client,
      // The SAME user directory the browser-session boundary composed: a second
      // directory is a second answer to who somebody is.
      peers: { users: session.users },
      // The SAME counter the public REST surface meters through, so a budget
      // cannot be spent twice by asking on two paths.
      rateLimit: (request) => this.rateLimiter.consume(request),
      deployment: this.options.identity ?? {},
      ...(this.options.mail ? { mail: this.options.mail } : {}),
      processName,
    });

    this.composedUser = composeUserFeature({
      prisma: database.client,
      peers: {
        users: session.users,
        auth: session.auth,
        organizations: tenancy.organizations,
        // ADR-027's mode, resolved once by the feature that owns the
        // signed-out doors: the account screens must report the mode the door
        // the person came through offered.
        resolveAuthProvider: () => this.composedAuthFeature.resolveAuthProvider(),
      },
      eventing: identityEventing,
      rateLimit: (request) => this.rateLimiter.consume(request),
      deployment: this.options.identity ?? {},
      ...(this.options.mail ? { mail: this.options.mail } : {}),
      processName,
    });

    this.composedPresence = composePresenceFeature({
      // The SAME Redis the queue owns: presence and the broadcast fan-out ride
      // the process's one connection rather than opening a second.
      redis: queueInfrastructure?.redis ?? null,
      projects,
      resources: options.resources,
    });

    this.composedApiKey = composeApiKeyFeature({
      audit: this.options.audit,
      peers: { apiKeys: tenancy.apiKeys },
    });
  }

  /**
   * Composes a reviewer's annotations, their scores and the queues they travel in. One gate,
   * and it is the database: every port here is a row read with a project or user id already in
   * hand.
   */
  private composeAnnotation(
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): ComposedAnnotationFeature {
    const projects = this.composedTenancy?.projects;
    const organizations = this.composedTenancy?.organizations;
    const users = this.composedAuth?.compose().users;
    // A host that injected its own api-key and organization pair composed no
    // tenancy here, so it holds those directories itself.
    if (!infrastructure || !projects || !organizations || !users) {
      return refusingAnnotationFeature();
    }

    return composeAnnotationFeature({
      infrastructure,
      peers: { projects, organizations, users, traceCommands: this.composedTraceCommands },
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      ...(this.options.traceContent ? { traceContent: this.options.traceContent } : {}),
    });
  }

  /**
   * The object store, over this process's own graph. One thing gates it: the database, because
   * the BYOC route lookup is a row read.
   */
  private composeStoredObject(options: ApiRuntimeCompositionOptions): ComposedStoredObjectFeature {
    const database = this.composedDatabase?.connection;
    if (!database) return refusingStoredObjectFeature();

    const feature = composeStoredObjectFeature({
      prisma: database.client,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      storage: options.config.infrastructure.storedObjects,
      report: LoggedApiStoredObjectAbsence.create(createLogger(options.config.serviceName)),
    });
    options.resources?.own("api stored-object aws clients", () => feature.close());
    return feature;
  }

  /**
   * The monitor surface, over this process's own graph. Two peers and nothing else: the monitor
   * and evaluator services the execution half composed, and the evaluator replication the
   * product-group half built over this process's workflow application.
   */
  private composeMonitor(options: ApiRuntimeCompositionOptions): ComposedMonitorFeature {
    const monitors = this.composedExecutionMonitors;
    const evaluators = this.composedEvaluators;
    if (!monitors || !evaluators) return refusingMonitorFeature();

    return composeMonitorFeature({
      peers: {
        monitors,
        evaluators,
        // The evaluator feature's own ports: a monitor copy carries its
        // evaluator and that evaluator's workflow with it, and a second
        // replication would be a second answer to what copying one does.
        evaluatorReplication: this.composedEvaluator.ports,
      },
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      report: LoggedApiMonitorAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * The retention surface, over this process's own graph. One peer: the operator allow-list,
   * taken off the identity half rather than parsed a second time, so "who may keep data
   * forever" and "who sees the operator sidebar" are never two answers.
   */
  private composeDataRetention(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
  ): ComposedDataRetentionFeature {
    const ops = this.composedUser.ops;
    const tenancy = this.composedTenancy;
    if (!infrastructure || !ops || !tenancy) return refusingDataRetentionFeature();

    return composeDataRetentionFeature({
      infrastructure,
      peers: { ops, projects: tenancy.projects, organizations: tenancy.organizations },
      // The platform application's own floor. Stated rather than read from
      // config: defaulting to the adapter's shorter value would silently
      // shorten every project's window on a deployment that never changed a
      // setting.
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      // The SAME Redis the queue owns, and the SAME ClickHouse the charted
      // reads run on: the meter counts the rows the explorer reads.
      redis: queueInfrastructure?.redis ?? null,
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      report: LoggedApiDataRetentionAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * Composes the scenario feature over this process's own graph.
   */
  private composeScenario(
    options: ApiRuntimeCompositionOptions,
    authz: AuthzService,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    encryption: SecretEncryptionPort | undefined,
  ): ComposedScenarioFeature {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const agents = this.composedAgents?.agents;
    // The broadcast fabric presence publishes on. Read off the presence feature
    // rather than composed again: this half's subscription and every presence
    // event ride ONE emitter per tenant.
    const broadcast = this.composedPresence.broadcast;
    const auth = this.composedAuth?.compose();
    if (!database || !tenancy || !agents || !broadcast || !auth) {
      return refusingScenarioFeature();
    }

    // The four collaborators a scenario RUN is prepared against, and the NARROWING for them.
    // Each is already implied by a gate above — the gateway and the secret store need this
    // database, this tenancy graph and this cipher; the execution half needs the gateway and
    // the agent directory; the trace read stack is built by this root whenever the trace group
    // composes, and that needs the same database, tenancy and identity.
    const workflows = this.composedWorkflowRuntime?.workflows;
    const modelProviders = this.composedModelProviders;
    const secrets = this.secrets;
    const traces = this.composedTrace.traceReads?.readers().tree;
    if (!workflows || !modelProviders || !secrets || !traces) return refusingScenarioFeature();

    return composeScenarioFeature({
      prisma: database.client,
      authz,
      agents,
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
      users: auth.users,
      projects: tenancy.projects,
      broadcast: this.composedPresence.emitter,
      encryption,
      // The SAME routed ClickHouse the charted reads and the trace half use.
      resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
      redis: queueInfrastructure?.redis ?? null,
      // The senders the root registered, shared with the Langy feature: one
      // registration per definition, whatever composes over it.
      pipelines: this.composedAgentPipelines,
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
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
    // The broadcast fabric presence already publishes on. Read off the identity
    // half rather than composed again: both trace subscriptions and every
    // presence event ride ONE emitter per tenant, and two would leave a browser
    // watching a channel nothing writes to.
    const broadcast = this.composedPresence.emitter;
    if (!database || !tenancy || !grants || !broadcast) return refusingTraceFeature();

    return composeTraceFeature({
      prisma: database.client,
      authz,
      projects: tenancy.projects,
      broadcast,
      // The share ledger and the topic tree, taken rather than built: the same
      // ledger the settings form administers redeems an anonymous read's token,
      // and the same tree `topics.*` answers labels the grid's rows.
      peers: { share: this.composedShare.service, topics: this.composedTopic.service },
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
      ...(this.options.traceReads ? { traceReads: this.options.traceReads } : {}),
      // The read stack, over the SAME retention cascade and topic tree the
      // group composes for its own surfaces: a span read's floor and a grid
      // row's topic label must be the ones the retention screen and the topic
      // page show, and a second of either would be a second answer.
      traceReadsFrom: () =>
        composeApiTraceReadStack({
          prisma: database.client,
          resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null,
          authz,
          projects: tenancy.projects,
          plans: this.resolvePlanProvider(options),
          dataRetention: this.composedDataRetention.service,
          topics: this.composedTopic.service,
          // The evaluations behind a trace, on the SAME ClickHouse and the
          // SAME retention cascade the trace itself is read through. Every
          // single-trace read asks for them, so a stack composed without one
          // answered a 500 rather than a trace.
          ...(this.composedClickHouse
            ? {
                evaluations: composeApiEvaluationReads({
                  resolveClickHouseClient: this.composedClickHouse.resolveClient,
                  dataRetention: this.composedDataRetention.service,
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
   * Composes the studio's outbound dispatch and the provider surfaces.
   */
  private composeStudioHost(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
  ): ApiStudioHostPort {
    return (
      this.options.studio ??
      composeApiStudioHost({
        nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
        modelProviders: this.resolveModelProviders(options, encryption),
        ...(this.composedEventing
          ? {
              traceIngest: {
                recordSpan: (data) => this.composedTraceCommands.recordSpan(data),
              },
            }
          : {}),
        processName: options.config.serviceName,
      })
    );
  }

  /** The vendor probes, the Codex device flow and the cost-rule preview. */
  private composeModelProviderHost(
    options: ApiRuntimeCompositionOptions,
  ): ApiModelProviderHostPort {
    return (
      this.options.modelProviderHost ??
      composeApiModelProviderHost({
        egress: {
          blockLocal: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
          allowedHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
          verifyTls: options.config.infrastructure.modelProvider.isSaas,
        },
        environment: options.config.infrastructure.modelProvider.environment,
        processName: options.config.serviceName,
      })
    );
  }

  /**
   * Composes an organization's spend and the allowance it is taken against. ONE plan provider
   * serves both, because the panel and every banner that quotes an allowance must agree about
   * which plan an organization is on.
   */
  private composeSpend(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): ComposedSpendFeature {
    if (!infrastructure) return refusingSpendFeature();
    const usage =
      this.options.usage ??
      composeApiUsageStats({
        prisma: infrastructure.prisma,
        plans: this.resolvePlanProvider(options),
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

    return composeSpendFeature({
      infrastructure,
      usage,
      report: LoggedApiSpendAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * Composes the five tenant-administration features over this process's own graph.
   */
  private composeTenantFeatures(
    options: ApiRuntimeCompositionOptions,
    encryption: SecretEncryptionPort | undefined,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): void {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    // The evaluator service the execution features composed, for the monitor
    // directory below: taken rather than built so a monitor's evaluator and
    // the `evaluators.*` surface cannot disagree about what one runs.
    const evaluators = this.composedEvaluators;
    if (!infrastructure || !database || !tenancy || !evaluators) {
      this.composedOrganization = refusingOrganizationFeature();
      this.composedProject = refusingProjectFeature();
      this.composedCodingAgent = refusingCodingAgentFeature();
      this.composedAutomation = refusingAutomationFeature();
      this.composedEnterprise = refusingEnterpriseFeature();
      return;
    }

    // Injected wins; otherwise the service this process composed over its own
    // graph. Resolved here rather than left to the organization feature's own
    // fold because the management REST family administers the same
    // invitations, and one service is what keeps the two doors from
    // disagreeing about them.
    const invites =
      this.options.organizationInvites ?? this.resolveOrganizationInvites(options)?.trpc;

    // The membership half: the seats, groups, join requests and sign-up
    // ceremony this feature serves over the graph the person-shaped features
    // already composed. All of it or none — a process holding part of it would
    // let somebody be admitted by one door and be invisible to the next.
    const grants = this.composedAuthz?.grants;
    const session = this.composedAuth?.compose();
    const membership =
      grants && session
        ? {
            organizations: tenancy.organizations,
            projects: tenancy.projects,
            grants,
            auth: session.auth,
            // The SAME application `user.*` answers from: a second would
            // provision a personal workspace for somebody the /me screens do
            // not know.
            users: this.composedUser.app,
            // The senders the root registered for the identity ledgers: one
            // registration per definition, whatever composes over it.
            eventing: this.composedIdentityEventing,
            ...(this.options.mail ? { mail: this.options.mail } : {}),
            processName: options.config.serviceName,
          }
        : undefined;

    this.composedOrganization = composeOrganizationFeature({
      infrastructure,
      peers: {
        encryption,
        ...(invites ? { invites } : {}),
        ...(this.options.enterprise ? { enterprise: this.options.enterprise } : {}),
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

    this.composedProject = composeProjectFeature({
      infrastructure,
      peers: {
        projects: tenancy.projects,
        apiKeys: tenancy.apiKeys,
        // Taken rather than built: a second share ledger or topic tree would
        // let the settings form and the explorer disagree about what a
        // project holds.
        share: this.composedShare.service,
        topics: this.composedTopic.service,
        encryption,
        ...(this.options.viewerProtections
          ? { viewerProtections: this.options.viewerProtections }
          : {}),
      },
    });

    this.composedCodingAgent = composeCodingAgentFeature({
      infrastructure,
      peers: {
        projects: tenancy.projects,
        github: this.resolveGithub(options, database.client, queueInfrastructure, tenancy),
        // The SAME ClickHouse the charted reads and the traces run on: a
        // coding-agent session is a projection in that instance, and a second
        // connection would be a second pool.
        clickHouse: this.resolveCodingAgentClickHouse(),
        ...(this.options.viewerProtections
          ? { viewerProtections: this.options.viewerProtections }
          : {}),
      },
    });

    this.composedAutomation = composeAutomationFeature({
      infrastructure,
      peers: {
        projects: tenancy.projects,
        monitors: this.resolveMonitors(database.client, evaluators),
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

    this.composedEnterprise = composeEnterpriseFeature({
      audit: this.options.audit,
      ...(this.options.enterprise ? { enterprise: this.options.enterprise } : {}),
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
      // The SAME fabric presence already publishes on: both live channels ride
      // one emitter per tenant rather than a second of their own.
      broadcast: this.composedPresence.emitter,
      demoProjectId: options.config.authz.demoProjectId,
      rateLimit: (request) => this.rateLimiter.consume(request),
      processName: options.config.serviceName,
    });
  }

  /**
   * The operator back office, over this process's own graph. Three peers and nothing else: the
   * user directory a back-office row names, the browser session an impersonation is started and
   * stopped against, and the project directory a scheduled job is scoped to.
   */
  private composeOps(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
    tenancy: ApiTenancyComposition | undefined,
  ): ComposedOpsFeature {
    const auth = this.composedAuth?.compose();
    if (!infrastructure || !auth || !tenancy) return refusingOpsFeature();

    return composeOpsFeature({
      infrastructure,
      peers: { users: auth.users, auth: auth.auth, projects: tenancy.projects },
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
      report: LoggedApiOpsAbsence.create(createLogger(options.config.serviceName)),
    });
  }

  /**
   * The gateway-group half, over this process's own graph.
   */
  private composeGateway(
    options: ApiRuntimeCompositionOptions,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): ComposedGatewayFeature {
    const database = this.composedDatabase?.connection;
    const tenancy = this.composedTenancy;
    const evaluators = this.composedEvaluators;

    // A host's ledger wins: a process handed the product graph already holds
    // one, and a second over the same receipt table would be a second takeover
    // clock racing the first one's claims. Otherwise this process's own, which
    // is absent only where it composed no database or no cipher — and then the
    // three keyed creates refuse by name rather than executing unguarded.
    const idempotency = this.options.gatewayIdempotency ?? this.composedIdempotency?.gateway;

    return composeGatewayFeature({
      infrastructure,
      // The three other features the gateway reaches, named one by one. Absent
      // together: a process holding none of them composes a refusing gateway,
      // and only the gateway's own six namespaces are affected.
      peers:
        database && tenancy && evaluators
          ? {
              projects: tenancy.projects,
              evaluators,
              // The SAME monitor directory the automation application and the
              // monitor surface read: a guardrail attachment and the monitor
              // page it points at must agree about what one runs.
              monitors: this.resolveMonitors(database.client, evaluators),
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
   * The monitor directory, memoized.
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
    const roles = this.composedRole.roles;
    if (!database || !grants) return undefined;

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

  private resolvePlanProvider(options: ApiRuntimeCompositionOptions): PlanProvider {
    if (this.composedPlanProvider) return this.composedPlanProvider;
    const database = this.composedDatabase?.connection;
    this.composedPlanProvider = composeApiPlanProvider({
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
      adminEmails: this.options.identity?.adminEmails
        ? AdminAccessService.parseEmails(this.options.identity.adminEmails)
        : [],
      report: this.entitlementAbsence(options),
    });
    return this.composedPlanProvider;
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
  ): ModelProviderService | undefined {
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
   * Composes the execution half of the collaborator set over this process's own graph.
   */
  private composeExecutionFeatures(
    options: ApiRuntimeCompositionOptions,
    agents: AgentService | undefined,
    encryption: SecretEncryptionPort | undefined,
    tenancy: ApiResolvedTenancy,
    queueInfrastructure: ApiQueueInfrastructure | undefined,
    infrastructure: ApiTrpcInfrastructure | undefined,
  ): void {
    const database = this.composedDatabase?.connection;
    const modelProviders = this.resolveModelProviders(options, encryption);
    // Held so the product-group half reads the SAME gateway rather than
    // composing a second: a stored prompt version's model reference and a
    // studio node's model must resolve to one provider, not to two.
    this.composedModelProviders = modelProviders;
    if (!database || !agents || !modelProviders || !infrastructure) {
      LoggedApiExecutionAbsence.create(createLogger(options.config.serviceName)).absent({
        database: Boolean(database),
        agents: Boolean(agents),
        modelProviders: Boolean(modelProviders),
      });
      this.composedWorkflow = refusingWorkflowFeature();
      this.composedExperiment = refusingExperimentFeature();
      this.composedEvaluation = refusingEvaluationFeature();
      return;
    }

    // The order below is the graph's own: a dataset is read by the studio, the
    // studio's service is what an evaluator publishes through, an evaluator is
    // what a monitor runs, and an experiment reaches all four.
    const datasets = composeDatasetService({ infrastructure });
    this.composedDatasets = datasets;
    const workflowRuntime = composeWorkflowRuntime({
      infrastructure,
      peers: { datasets, modelProviders },
      nlpServiceUrl: options.config.infrastructure.execution.nlpServiceUrl,
      secretDecryptor: encryption,
    });
    this.composedWorkflowRuntime = workflowRuntime;
    const evaluators = composeEvaluatorService({
      infrastructure,
      peers: { workflows: workflowRuntime.workflows, nlpRuntime: workflowRuntime.nlpRuntime },
    });
    this.composedEvaluators = evaluators;
    const monitors = composeMonitorService({ infrastructure, peers: { evaluators } });
    this.composedExecutionMonitors = monitors;

    this.composedWorkflow = composeWorkflowFeature({
      infrastructure,
      runtime: workflowRuntime,
      peers: { datasets, evaluators, modelProviders },
    });

    // The re-score and the pipeline producer, composed before the experiment
    // feature because the workbench's own cells report on the SAME sender.
    this.composedEvaluation = composeEvaluationFeature({
      infrastructure,
      peers: { modelProviders, workflowRuntime },
      processName: options.config.serviceName,
      eventing: this.composedEventing?.eventSourcing,
      // The studio's own re-score, over the process's ONE evaluator runtime.
      // Resolved at the call rather than passed as a value because the runtime
      // is built FROM this evaluator service and the trace read stack: at this
      // line neither exists yet, and at the call both do. An absent runtime
      // still refuses by name, one layer down.
      runEvaluationForTrace: (_ctx, input) =>
        this.requireEvaluatorExecution().runEvaluationForTrace({
          projectId: input.projectId,
          traceId: input.traceId,
          evaluatorType: input.evaluatorType,
          settings: input.settings,
          mappings: input.mappings,
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
        reportEvaluation: this.composedEvaluation.reportEvaluation,
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
      runReport: LoggedApiExperimentRunAbsence.create(createLogger(options.config.serviceName)),
    });
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

/**
 * Names what the agent service is missing once, at boot, rather than leaving it to be inferred.
 * Two different facts, so two different lines.
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
      "API composed no agent service and no host supplied one: agents.* mounts against the null object and refuses every call by name",
    );
  }

  withoutWorkflowCopies(): void {
    this.logger.info(
      { reason: "no-workflow-application" },
      "API composed its agent service without a workflow-copy capability: every agent operation is served except copying a workflow agent, which needs the Studio graph this process does not compose",
    );
  }
}

/** Names the connected-agent transport's (ADR-128) composition decisions once, at boot. */
export class LoggedApiConnectedAgentsAbsence extends ApiConnectedAgentsAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedApiConnectedAgentsAbsence {
    return new LoggedApiConnectedAgentsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutDatabase(): void {
    this.logger.warn(
      { reason: "no-database" },
      "API composed no connected-agent transport: with no database an instance has nowhere to register, so the WebSocket gateway and the /connect/* long-poll routes do not mount",
    );
  }

  withoutSharedStore(replicaCount: number): void {
    this.logger.warn(
      { reason: "no-redis", replicaCount },
      "API composed the connected-agent transport on a memory store with more than one app replica: every connect refuses replica_count_unsupported, because an instance registered on one pod would be invisible to the others. Configure Redis, or run a single replica",
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
