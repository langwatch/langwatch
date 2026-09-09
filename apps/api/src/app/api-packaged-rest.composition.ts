/**
 * The packaged REST families' collaborators, composed from this process's own graph.
 */
import { TraceContentExtractionService } from "@langwatch/trace-server";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type {
  AppRestManagementAuditPort,
  AppRestRbacVocabulary,
  PlatformUrlBuilder,
  RestErrorHandler,
} from "@langwatch/api/rest";
import {
  ALL_PERMISSIONS,
  bindingScopeCanGrantPermission,
  permissionResource,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import type { ScimApi } from "@langwatch/enterprise-api";
import { createEnterprisePlanGate } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { StoredObjectsService } from "@langwatch/stored-object-server";
import { TraceMediaStorePort } from "@langwatch/trace-server";
import type {
  CollectorProject,
  CollectorUsageLimitPort,
} from "@langwatch/trace-server/api-rest/collector";
import type { TrackedEventPorts } from "@langwatch/trace-server/api-rest/tracked-event";
import type { WorkflowEvaluationOutcome } from "@langwatch/workflow-server";
import type { MiddlewareHandler } from "hono";

import type { EnterpriseGovernanceApplication } from "../features/enterprise/enterprise-governance.composition.ts";
import type { ComposedScenarioFeature } from "../features/scenario/scenario.composition.types.ts";
import type { ComposedAnalyticsFeature } from "../features/analytics/analytics.composition.types.ts";
import type { ComposedExperimentFeature } from "../features/experiment/experiment.composition.types.ts";
import type { ComposedWorkflowFeature } from "../features/workflow/workflow.composition.types.ts";
import type { ComposedPresenceFeature } from "../features/presence/presence.composition.types.ts";
import type { ComposedOrganizationFeature } from "../features/organization/organization.composition.types.ts";
import type { ComposedAutomationFeature } from "../features/automation/automation.composition.types.ts";
import type { ComposedCodingAgentFeature } from "../features/coding-agent/coding-agent.composition.types.ts";
import type { ComposedEnterpriseFeature } from "../features/enterprise/enterprise.composition.types.ts";
import type { ComposedDatasetFeature } from "../features/dataset/dataset.composition.types.ts";
import type { ComposedEvaluatorFeature } from "../features/evaluator/evaluator.composition.types.ts";
import type { ComposedDashboardFeature } from "../features/dashboard/dashboard.composition.types.ts";
import type { ComposedMonitorFeature } from "../features/monitor/monitor.composition.types.ts";
import type { ComposedStoredObjectFeature } from "../features/stored-object/stored-object.composition.types.ts";
import type { ApiHandlerManagedCredentials } from "./api-handler-managed-credential.ts";
import type { ApiHandlerManagedSessionPort } from "./api-handler-managed-session.ts";
import type { ApiTraceIngestComposition } from "./api-trace-ingest.composition.ts";
import { createApiTrackedEventPorts } from "../features/trace/tracked-event-ports.adapter.ts";
import { createAgentPlatformUrlBuilder } from "../features/agent/agent-platform-url.ts";
import { createDatasetDirectUploadAuthorizer } from "../features/dataset/dataset-direct-upload-auth.ts";
import { createApiUserAvatarObjectReader } from "../features/user/user-avatar-objects.adapter.ts";
import { createScenarioRunPlatformUrlBuilder } from "../features/scenario/scenario-run-platform-url.ts";
import {
  MemoryAgentCacheEntryStore,
  RedisAgentCacheEntryStore,
} from "../features/agent-cache/agent-cache.store.ts";
import { AgentCacheService } from "../features/agent-cache/agent-cache.service.ts";
import { canonicalErrorFor } from "./api-canonical-error.ts";
import { composeApiWebhookApplication } from "../features/enterprise/enterprise-webhook.composition.ts";
import { orgRequestLedgerActor } from "./api-ledger-actor.ts";
import { createApiDualCredentialAuth } from "./api-dual-credential-auth.ts";
import {
  ApiRestCapabilityUnavailableError,
  createOrganizationMiddleware,
} from "./api-rest-ports.ts";
import type { ApiPackagedRestCollaborators } from "../app-rest/api-rest.packaged-services.ts";
import type { ApiConnectedAgentsComposition } from "./api-connected-agents.composition.ts";
import type { AgentApi } from "@langwatch/agent-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { FilesRateLimiter } from "@langwatch/stored-object-server";
import type { ApiAuditPort } from "../api-request.policy.ts";
import { requestTraceIds } from "@langwatch/api/rest";

/** What the packaged families are composed from, all of it already open. */
export type ApiPackagedRestCompositionOptions = Readonly<{
  agents: AgentApi | undefined;
  /** The connected-agent transport (ADR-128), for `/api/v1/agents`'s connect and call routes. */
  connectedAgents: ApiConnectedAgentsComposition | undefined;
  relayMaxPayloadMb?: number;
  scenario: ComposedScenarioFeature;
  analytics: ComposedAnalyticsFeature;
  authz: AuthzService;
  credentials: ApiHandlerManagedCredentials;
  encryption: SecretEncryptionPort | undefined;
  experiment: ComposedExperimentFeature;
  workflow: ComposedWorkflowFeature;
  /**
   * The Enterprise governance slices the `/api/governance` and `/api/webhooks/v1`
   * families are handed.
   */
  enterpriseGovernance: EnterpriseGovernanceApplication;
  /** The tenant fan-out the bulk exports report their progress on. */
  presence: ComposedPresenceFeature;
  /** The organization object `/api/organizations` provisions a tenant through. */
  organization: ComposedOrganizationFeature;
  automation: ComposedAutomationFeature;
  codingAgent: ComposedCodingAgentFeature;
  enterprise: ComposedEnterpriseFeature;
  /** The directory-sync application, where this process installed the feature. */
  scim: ScimApi | undefined;
  /** A project's datasets, where this process installed the feature. */
  dataset: ComposedDatasetFeature | undefined;
  /** A project's evaluators, where this process composed the feature. */
  evaluator: ComposedEvaluatorFeature | undefined;
  /** The monitors a project runs, where this process installed the feature. */
  monitor: ComposedMonitorFeature | undefined;
  /** A project's dashboards and the graphs on them, where one was installed. */
  dashboard: ComposedDashboardFeature | undefined;
  /** The process's own error envelope, which every declared family answers in. */
  legacyErrors: RestErrorHandler;
  storedObject: ComposedStoredObjectFeature;
  plans: PlanProvider | undefined;
  /** The deployment's public origin, where it declared one. */
  publicBaseUrl: string | undefined;
  /** The process's ONE fixed-window counter. */
  rateLimit: FilesRateLimiter;
  redis: RedisConnection | undefined;
  /** The browser session, where this deployment composed a transport. */
  session: ApiHandlerManagedSessionPort | undefined;
  /**
   * The ingest doors' one dedup gate and command sender, where this process registered a
   * command queue.
   */
  traceIngest: ApiTraceIngestComposition | undefined;
  /** The credential pair and the project directory every family resolves through. */
  apiKeys: ApiKeyApi;
  organizations: OrganizationService;
  projects: ProjectService | undefined;
  /** The provider gateway the two model families read, where one was composed. */
  modelProviders: ModelProviderService | undefined;
  /**
   * The API-key ceiling for one permission, as the framework chain applies it.
   */
  requireApiKeyPermission: (permission: AuthzPermission) => MiddlewareHandler;
  audit: ApiAuditPort | undefined;
  managementAudit: AppRestManagementAuditPort;
  /** Whether this deployment is the hosted product rather than self-hosted. */
  isSaas: boolean;
  /** The configured instance administrator credential, read per request. */
  instanceAdminKey: () => string | undefined;
  logger: Pick<Logger, "warn" | "error">;
}>;

/**
 * Binds every packaged family this process can serve. Always returns a bag: the families
 * themselves are individually conditional, and a process that composed none of them still
 * mounts none rather than mounting a list of refusals.
 */
export function composeApiPackagedRest(
  options: ApiPackagedRestCompositionOptions,
): ApiPackagedRestCollaborators {
  const platformUrl = createPlatformUrl(options.publicBaseUrl);
  const enterpriseGate = composeEnterpriseGate(options.plans);
  // `/api/webhooks/v1`'s entitlement gate is this deployment's plan read, not
  // the Enterprise governance application's — see the module for why.
  const webhooks = composeApiWebhookApplication({
    webhooks: options.enterpriseGovernance.webhooks,
    plans: options.plans,
  });
  const agentCache = composeAgentCache(options);
  const scim = options.scim;
  const storedObjectBytes = options.storedObject.bytes;
  const dualAuth = options.session
    ? createApiDualCredentialAuth({
        apiKeys: options.apiKeys,
        session: options.session,
        credentials: options.credentials,
      })
    : undefined;

  return {
    services: {
      ...(agentCache ? { agentCache: () => agentCache } : {}),
      ...(options.agents ? { agents: () => options.agents! } : {}),
      ...(options.connectedAgents
        ? {
            agentsV1: () => ({
              connect: { relayMaxPayloadMb: options.relayMaxPayloadMb },
              call: { relayMaxPayloadMb: options.relayMaxPayloadMb },
            }),
          }
        : {}),
      apiKeys: () => options.apiKeys,
      ...(options.automation.service ? { automation: () => options.automation.service! } : {}),
      ...(options.codingAgent.service ? { codingAgents: () => options.codingAgent.service! } : {}),
      ...(scim ? { scim: () => scim } : {}),
      ...(options.dashboard ? { dashboard: options.dashboard.restServices.dashboard } : {}),
      ...(options.dataset ? { datasets: () => options.dataset!.app } : {}),
      ...(options.evaluator ? { evaluators: options.evaluator.restServices.evaluators } : {}),
      permissions: () => options.authz,
      ...(options.experiment.experiments ? { experiments: () => options.experiment.app } : {}),
      governance: () => options.enterpriseGovernance.governanceApp,
      webhooks: () => webhooks,
      ...(options.presence.broadcast ? { broadcast: () => options.presence.broadcast! } : {}),
      ...(options.organization.provisioning
        ? { organizationProvisioning: () => options.organization.provisioning! }
        : {}),
      organizations: () => options.organizations,
      ...(options.projects ? { projects: () => options.projects! } : {}),
      ...(options.monitor ? { monitors: options.monitor.restServices.monitors } : {}),
      storedObjects: () => options.storedObject.app,
      // The SAME application `/api/files` reads through, in the shape the
      // avatar family takes. Its row carries the owner kind, which is what
      // makes the family's refusal of every non-avatar object a real check
      // rather than a comparison against a field nobody projected.
      userAvatarObjects: () => createApiUserAvatarObjectReader(() => options.storedObject.app),
      scenarios: () => options.scenario.scenarioService,
      scenarioTabs: () => options.scenario.scenarioTabs,
      simulations: () => options.scenario.simulations,
      // Both tracked-event URLs, over the SAME span collection the OTLP
      // receiver and the SDK collector send on. Absent where this process
      // registered no command queue: with nowhere to send the span, the door
      // would answer 200 to a rating it then dropped.
      ...(options.traceIngest ? { trackedEvents: trackedEventPortsFrom(options) } : {}),
      ...(options.workflow.service ? { workflows: () => options.workflow.service! } : {}),
      ...(options.modelProviders ? { modelProviders: () => options.modelProviders! } : {}),
    },
    ports: {
      agentPlatformUrl: createAgentPlatformUrlBuilder(platformUrl),
      platformUrl,
      scenarioRunPlatformUrl: createScenarioRunPlatformUrlBuilder(platformUrl),
      canonicalError: (error, c) => canonicalErrorFor(error, requestTraceIds(c)),
      organizationMiddleware: createOrganizationMiddleware(() => options.organizations),
      managementAudit: options.managementAudit,
      organizationLedgerActor: orgRequestLedgerActor,
      instanceAdminKey: options.instanceAdminKey,
      isSaas: () => options.isSaas,
      // The compensation's own failure is reported and never raised: the
      // caller must still see the ORIGINAL failure.
      reportError: (error) => options.logger.error({ error }, "REST compensation failed"),
      rateLimit: options.rateLimit,
      // The SAME door every process-owned declared family authenticates
      // through, so a project key opens one door on this process rather than
      // two that could disagree about what it may reach.
      handlerManagedCredential: (input) => options.credentials.authenticate(input),
      legacyErrors: options.legacyErrors,
      requireApiKeyPermission: options.requireApiKeyPermission,
      // The SAME gate object both ingest doors hold, applied to the one packaged family
      // that reports run data: a scenario event is trace content, and a project over its
      // plan must be refused at every door that writes it or the allowance is only
      // advisory.
      traceUsageGuard: traceUsageGuardFor({
        usageLimit: options.traceIngest?.usageLimit,
        logger: options.logger,
      }),
      requireProjectPermission: (args) => options.authz.authorizeProjectPermission(args),
      ...(dualAuth ? { dualAuth } : {}),
      ...(enterpriseGate ? { enterpriseGate } : {}),
      ...(options.session && options.projects
        ? {
            authorizeDatasetDirectUpload: createDatasetDirectUploadAuthorizer({
              session: options.session,
              credentials: options.credentials,
              projects: () => options.projects!,
            }),
          }
        : {}),
      ...(storedObjectBytes
        ? {
            extractInlineMedia: (input) =>
              TraceContentExtractionService.extractInlineMediaFromEvent({
                ...input,
                service: ApiTraceMediaStore.create(storedObjectBytes),
              }),
          }
        : {}),
      // A workflow run started from REST reaches the evaluations pipeline this
      // process does not compose a runner for, so the one route that starts it
      // refuses BY NAME while the five that read and write the graph answer.
      triggerWorkflowEvaluation: (): Promise<WorkflowEvaluationOutcome> =>
        Promise.reject(new ApiRestCapabilityUnavailableError("workflow evaluation runner")),
    },
  } as ApiPackagedRestCollaborators;
}

/**
 * Refuses a project's write once its team has spent the plan's allowance.
 */
function traceUsageGuardFor(options: {
  usageLimit: CollectorUsageLimitPort | undefined;
  logger: Pick<Logger, "error">;
}): MiddlewareHandler {
  const { usageLimit } = options;
  if (!usageLimit) {
    return async (_c, next) => {
      await next();
    };
  }
  return async (c, next) => {
    const project = c.get("project") as CollectorProject | undefined;
    if (!project) {
      // The chain that resolves the credential is what sets it, so this is a
      // mounting defect rather than a caller's. Reported and passed through:
      // taking an ingest door down over our own wiring loses a customer's
      // telemetry, which is the one failure an exporter cannot retry.
      options.logger.error(
        {},
        "the trace usage guard ran without a resolved project, so this write was not metered",
      );
      await next();
      return;
    }
    await usageLimit({ project });
    await next();
  };
}

/**
 * The content-addressed store, in the shape the trace vertical's extractor takes.
 */
export class ApiTraceMediaStore extends TraceMediaStorePort {
  static create(store: StoredObjectsService): ApiTraceMediaStore {
    return new ApiTraceMediaStore(store);
  }

  private constructor(private readonly store: StoredObjectsService) {
    super();
  }

  storeFromBytes(input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }> {
    return this.store.storeFromBytes(input);
  }
}

/**
 * The tracked-event family's ports, over the span builder the ingest composition already
 * holds.
 */
function trackedEventPortsFrom(
  options: ApiPackagedRestCompositionOptions,
): () => TrackedEventPorts {
  const ports = createApiTrackedEventPorts({
    spans: options.traceIngest!.trackedEventSpans,
    logger: options.logger,
  });
  return () => ports;
}

/**
 * The agent cache's store and cipher. Absent without a cipher: an entry holds whatever an
 * agent produced — a session envelope, a provider token — and writing it in the clear so
 * the family could mount would put that on a shared Redis in plaintext.
 */
function composeAgentCache(
  options: ApiPackagedRestCompositionOptions,
): AgentCacheService | undefined {
  if (!options.encryption) return undefined;
  const store = options.redis
    ? RedisAgentCacheEntryStore.create(options.redis)
    : MemoryAgentCacheEntryStore.create();
  return new AgentCacheService(store, options.encryption);
}

/**
 * Refuses a route unless the resolved organization's plan is Enterprise. Absent without a
 * plan provider rather than passing: a gate that cannot read a plan and admits anyway
 * hands an Enterprise capability to every deployment.
 */
function composeEnterpriseGate(
  plans: PlanProvider | undefined,
):
  | ((feature: Parameters<ReturnType<typeof createEnterprisePlanGate>>[0]) => MiddlewareHandler)
  | undefined {
  if (!plans) return undefined;
  const gate = createEnterprisePlanGate({
    organization: (context) => context.get("organization") as { id: string } | undefined,
    plans: () => plans,
  });
  return (feature) => gate(feature);
}

/** The deep-link builder, from the deployment's public origin. */
function createPlatformUrl(publicBaseUrl: string | undefined): PlatformUrlBuilder {
  const base = (publicBaseUrl ?? "").replace(/\/+$/, "");
  return ({ projectSlug, path }) => {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}/${projectSlug}${cleanPath}`;
  };
}

/**
 * The permission vocabulary a custom role is written in, derived from the AuthZ registry
 * rather than kept as a second cross product.
 */
export const REGISTRY_RBAC_VOCABULARY: AppRestRbacVocabulary = {
  actions: [...new Set(ALL_PERMISSIONS.map((permission) => permission.split(":")[1] ?? ""))].sort(),
  resources: [...new Set(ALL_PERMISSIONS.map((permission) => permissionResource(permission)))],
  isOrganizationExclusive: (resource: string) => {
    const sample = ALL_PERMISSIONS.find(
      (permission) => permissionResource(permission) === resource,
    );
    return sample
      ? !bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission: sample })
      : false;
  },
};
