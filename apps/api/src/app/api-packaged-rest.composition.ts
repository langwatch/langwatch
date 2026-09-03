/**
 * The packaged REST families' collaborators, composed from this process's own
 * graph.
 *
 * One place rather than twenty-eight lines inside `composeDoors`, because the
 * decisions are all the same shape: take the service the process already
 * composed for its tRPC record — never build a second one — and bind the few
 * things that are the PROCESS's rather than any feature's (the deep links, the
 * plan gate, the ledger attribution, the permission vocabulary, the two byte
 * gates). A family whose service is missing is left out of the list this
 * returns, and {@link LoggedApiPackagedRestAbsence} says which and why at boot.
 *
 * Everything here is TAKEN. The reason is the one this migration keeps
 * meeting: two applications over one project's rows let two doors answer the
 * same question differently, and REST and tRPC are exactly two doors.
 */
import { AgentApp } from "@langwatch/agent-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type {
  AppRestManagementAuditPort,
  AppRestRbacVocabulary,
  PlatformUrlBuilder,
} from "@langwatch/api/rest";
import {
  ALL_PERMISSIONS,
  bindingScopeCanGrantPermission,
  permissionResource,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import { createEnterprisePlanGate } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { monitorApiMappingsSchema } from "@langwatch/monitor-contract";
import type { Logger } from "@langwatch/observability";
import { SecretApp, type SecretEncryptionPort } from "@langwatch/secret-server";
import type { SecretService } from "@langwatch/secret-contract";
import type { StoredObjectsService } from "@langwatch/stored-object-server";
import {
  extractInlineMediaFromEvent,
  TraceMediaStorePort,
  type TrackedEventPorts,
} from "@langwatch/trace-server";
import type { WorkflowEvaluationOutcome } from "@langwatch/workflow-server";
import type { MiddlewareHandler } from "hono";

import type { ApiAgentGroupCollaborators } from "./api-trpc-collaborators.agent-group.composition";
import type { ApiAnalyticsCollaborators } from "./api-trpc-collaborators.analytics.composition";
import type { ApiExecutionCollaborators } from "./api-trpc-collaborators.execution.composition";
import type { ApiGatewayGroupCollaborators } from "./api-trpc-collaborators.gateway-group.composition";
import type { ApiIdentityCollaborators } from "./api-trpc-collaborators.identity.composition";
import type { ApiOrgGroupCollaborators } from "./api-trpc-collaborators.org-group.composition";
import type { ApiProductGroupCollaborators } from "./api-trpc-collaborators.product-group.composition";
import type { ApiProductInfraCollaborators } from "./api-trpc-collaborators.product-infra.composition";
import type { ApiAuthzComposition } from "./api-authz.composition";
import type { ApiHandlerManagedCredentials } from "./api-handler-managed-credential";
import type { ApiHandlerManagedSessionPort } from "./api-handler-managed-session";
import type { ApiTraceIngestComposition } from "./api-trace-ingest.composition";
import { createApiTrackedEventPorts } from "../features/trace/tracked-event-ports.adapter";
import { createAgentPlatformUrlBuilder } from "../features/agent/agent-platform-url";
import { createDatasetDirectUploadAuthorizer } from "../features/dataset/dataset-direct-upload-auth";
import { createApiUserAvatarObjectReader } from "../features/user/user-avatar-objects.adapter";
import { createScenarioRunPlatformUrlBuilder } from "../features/scenario/scenario-run-platform-url";
import {
  MemoryAgentCacheEntryStore,
  RedisAgentCacheEntryStore,
} from "../features/agent-cache/agent-cache.store";
import { AgentCacheService } from "../features/agent-cache/agent-cache.service";
import { canonicalErrorFor } from "./api-canonical-error";
import { orgRequestLedgerActor } from "./api-ledger-actor";
import { createApiDualCredentialAuth } from "./api-dual-credential-auth";
import { ApiRestCapabilityUnavailableError, createOrganizationMiddleware } from "./api-rest-ports";
import type {
  ApiPackagedRestCollaborators,
  ApiPackagedRestFamilyName,
} from "../app-rest/app-rest.packaged-families";
import { ApiPackagedRestAbsenceReport } from "../app-rest/app-rest.packaged-families";
import type { ApiConnectedAgentsComposition } from "./api-connected-agents.composition";
import type { AgentService } from "@langwatch/agent-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { FilesRateLimiter } from "@langwatch/stored-object-server";
import type { ApiAuditPort } from "../api-request.policy";
import { requestTraceIds } from "@langwatch/api/rest";

/** What the packaged families are composed from, all of it already open. */
export type ApiPackagedRestCompositionOptions = Readonly<{
  agents: AgentService | undefined;
  /** The connected-agent transport (ADR-128), for `/api/v1/agents`'s connect and call routes. */
  connectedAgents: ApiConnectedAgentsComposition | undefined;
  agentGroup: ApiAgentGroupCollaborators | undefined;
  analytics: ApiAnalyticsCollaborators | undefined;
  authz: AuthzService;
  authzComposition: ApiAuthzComposition | undefined;
  credentials: ApiHandlerManagedCredentials;
  encryption: SecretEncryptionPort | undefined;
  execution: ApiExecutionCollaborators | undefined;
  gatewayGroup: ApiGatewayGroupCollaborators | undefined;
  identity: ApiIdentityCollaborators | undefined;
  orgGroup: ApiOrgGroupCollaborators | undefined;
  productGroup: ApiProductGroupCollaborators | undefined;
  productInfra: ApiProductInfraCollaborators | undefined;
  plans: PlanProvider | undefined;
  /** The deployment's public origin, where it declared one. */
  publicBaseUrl: string | undefined;
  /** The process's ONE fixed-window counter. */
  rateLimit: FilesRateLimiter;
  redis: RedisConnection | undefined;
  secrets: SecretService | undefined;
  /** The browser session, where this deployment composed a transport. */
  session: ApiHandlerManagedSessionPort | undefined;
  /**
   * The ingest doors' one dedup gate and command sender, where this process
   * registered a command queue.
   *
   * TAKEN rather than built here, and for a sharper reason than the rest of
   * this file gives: the tracked-event family writes a span whose id is a
   * digest of the trace and event ids, and that only deduplicates a retried
   * REST call against a redelivered SDK event while both claim the same Redis
   * keys. A second composition would score the same rating twice.
   */
  traceIngest: ApiTraceIngestComposition | undefined;
  /** The credential pair and the project directory every family resolves through. */
  apiKeys: ApiKeyService;
  organizations: OrganizationService;
  projects: ProjectService | undefined;
  /** The provider gateway the two model families read, where one was composed. */
  modelProviders: ModelProviderService | undefined;
  /**
   * The API-key ceiling for one permission, as the framework chain applies it.
   *
   * Handed in rather than built here: it is the SAME middleware the declared
   * access policies install, and a second implementation would be a second
   * answer to whether a key may do something.
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
 * Binds every packaged family this process can serve.
 *
 * Always returns a bag: the families themselves are individually conditional,
 * and a process that composed none of them still mounts none rather than
 * mounting a list of refusals.
 */
export function composeApiPackagedRest(
  options: ApiPackagedRestCompositionOptions,
): ApiPackagedRestCollaborators {
  const platformUrl = createPlatformUrl(options.publicBaseUrl);
  const enterpriseGate = composeEnterpriseGate(options.plans);
  const agentCache = composeAgentCache(options);
  const storedObjectBytes = options.productInfra?.storedObjectBytes;
  const dualAuth = options.session
    ? createApiDualCredentialAuth({ apiKeys: options.apiKeys, session: options.session })
    : undefined;

  return {
    services: {
      ...(agentCache ? { agentCache: () => agentCache } : {}),
      ...(options.agents ? { agents: agentAppFrom(options.agents) } : {}),
      ...(options.connectedAgents
        ? { agentsV1: agentsV1ConnectedFrom(options.connectedAgents) }
        : {}),
      apiKeys: () => options.apiKeys,
      ...(options.authzComposition ? { authzGrants: () => options.authzComposition!.grants } : {}),
      ...(options.orgGroup
        ? {
            automation: () => options.orgGroup!.application.automation,
            codingAgents: () => options.orgGroup!.application.codingAgentApp,
            scim: () => options.orgGroup!.application.scimApp,
          }
        : {}),
      // REST audits a read that names people; tRPC does not, which is why this
      // is a port of the family rather than something the application does.
      codingAgentAudit: () => ({
        auditLog: async (entry) => {
          await options.audit?.record({
            actorId: entry.userId,
            path: entry.action,
            input: {
              organizationId: entry.organizationId,
              targetId: entry.targetId,
              ...entry.args,
            },
            error: null,
          });
        },
      }),
      ...(options.analytics ? { dashboard: () => options.analytics!.dashboard } : {}),
      ...(options.productGroup
        ? {
            datasets: () => options.productGroup!.datasetApp,
            evaluators: () => options.productGroup!.evaluatorApp,
            permissions: () => options.authz,
            roles: () => options.productGroup!.roles,
          }
        : {}),
      ...(options.execution ? { experiments: () => options.execution!.experiments } : {}),
      ...(options.gatewayGroup
        ? {
            governance: () => options.gatewayGroup!.application.governanceApp,
            webhooks: () => options.gatewayGroup!.application.webhooks,
          }
        : {}),
      ...(options.identity
        ? {
            broadcast: () => options.identity!.broadcast,
            organizationProvisioning: () => options.identity!.organizationProvisioning,
          }
        : {}),
      organizations: () => options.organizations,
      ...(options.projects ? { projects: () => options.projects! } : {}),
      ...(options.productInfra
        ? {
            monitors: () => options.productInfra!.monitorApp,
            storedObjects: () => options.productInfra!.storedObjectApp,
            // The SAME application `/api/files` reads through, in the shape the
            // avatar family takes. Its row carries the owner kind, which is
            // what makes the family's refusal of every non-avatar object a real
            // check rather than a comparison against a field nobody projected.
            userAvatarObjects: () =>
              createApiUserAvatarObjectReader(() => options.productInfra!.storedObjectApp),
          }
        : {}),
      ...(options.agentGroup
        ? {
            scenarios: () => options.agentGroup!.scenarioService,
            scenarioTabs: () => options.agentGroup!.scenarioTabs,
            simulations: () => options.agentGroup!.simulations,
            suites: () => options.agentGroup!.suites,
          }
        : {}),
      ...(options.secrets ? { secrets: secretAppFrom(options.secrets) } : {}),
      // Both tracked-event URLs, over the SAME span collection the OTLP
      // receiver and the SDK collector send on. Absent where this process
      // registered no command queue: with nowhere to send the span, the door
      // would answer 200 to a rating it then dropped.
      ...(options.traceIngest ? { trackedEvents: trackedEventPortsFrom(options) } : {}),
      ...(options.execution
        ? { workflows: () => options.execution!.workflows.workflowService }
        : {}),
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
      rbacVocabulary: REGISTRY_RBAC_VOCABULARY,
      instanceAdminKey: options.instanceAdminKey,
      isSaas: () => options.isSaas,
      // The compensation's own failure is reported and never raised: the
      // caller must still see the ORIGINAL failure.
      reportError: (error) => options.logger.error({ error }, "REST compensation failed"),
      rateLimit: options.rateLimit,
      // The contract's own permissive parse. The field/rule cross-check needs
      // the trace-mapping registry, which lives in `@langwatch/trace-web` and
      // no server module may value-import a browser package — the same
      // narrowing the monitors tRPC surface already settled for.
      monitorMappingsSchema: monitorApiMappingsSchema,
      requireApiKeyPermission: options.requireApiKeyPermission,
      // The allowance this process cannot read. The SAME degradation the OTLP
      // receiver has always had when the lookup failed: telemetry a customer
      // already paid to produce is accepted, and the absent meter is reported
      // at boot rather than once per request.
      traceUsageGuard: async (_c, next) => {
        await next();
      },
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
              extractInlineMediaFromEvent({
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
 * The content-addressed store, in the shape the trace vertical's extractor
 * takes.
 *
 * A bridge in the PROCESS rather than a dependency between two feature server
 * packages: the extractor is the trace vertical's rule about message content,
 * the store is the stored-object vertical's, and neither package may reach the
 * other. It is the same seam the LiteLLM parameter resolution and the Azure
 * credential read already occupy.
 */
class ApiTraceMediaStore extends TraceMediaStorePort {
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

/** The agent application over the service this process already resolved. */
function agentAppFrom(agents: AgentService): () => AgentApp {
  const app = AgentApp.create({ agents });
  return () => app;
}

/**
 * The `/api/v1/agents` family's connected-agent deps, over the SAME
 * composition the WebSocket gateway and the long-poll transport run on — a
 * relay dispatched through this door and one delivered over the socket read
 * one runtime.
 */
function agentsV1ConnectedFrom(connectedAgents: ApiConnectedAgentsComposition) {
  return () => ({
    connectedRuntime: () => connectedAgents.runtime,
    connect: {
      transport: () => connectedAgents.longPoll,
      ...(connectedAgents.relayMaxPayloadMb !== undefined
        ? { relayMaxPayloadMb: connectedAgents.relayMaxPayloadMb }
        : {}),
    },
    call: {
      runtime: () => connectedAgents.runtime,
      assertRunnable: connectedAgents.assertRunnable,
      ...(connectedAgents.relayMaxPayloadMb !== undefined
        ? { relayMaxPayloadMb: connectedAgents.relayMaxPayloadMb }
        : {}),
    },
  });
}

/** The secret application over the service the process already resolved. */
function secretAppFrom(secrets: SecretService): () => SecretApp {
  const app = SecretApp.create({ secrets });
  return () => app;
}

/**
 * The tracked-event family's ports, over the span builder the ingest
 * composition already holds.
 *
 * Bound once and handed back by a provider, the way the two applications above
 * are: the bag is closures over one builder and one logger, and building a
 * second one per mount would make the two doors' error sinks two objects for
 * no gain.
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
 * The agent cache's store and cipher.
 *
 * Absent without a cipher: an entry holds whatever an agent produced — a
 * session envelope, a provider token — and writing it in the clear so the
 * family could mount would put that on a shared Redis in plaintext.
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
 * Refuses a route unless the resolved organization's plan is Enterprise.
 *
 * Absent without a plan provider rather than passing: a gate that cannot read
 * a plan and admits anyway hands an Enterprise capability to every deployment.
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
 * The permission vocabulary a custom role is written in, derived from the
 * AuthZ registry rather than kept as a second cross product.
 *
 * The platform application kept its own action and resource lists plus a
 * hand-maintained organization-exclusive set that its own source marked
 * `@deprecated`. Deriving all three from `ALL_PERMISSIONS` is what makes the
 * catalogue `/api/roles` publishes and the check the engine performs one fact.
 *
 * Exported because the OpenAPI generator needs the SAME vocabulary: the custom
 * roles family builds its request enum from this list at mount time, so a
 * description composed over a stand-in vocabulary would publish an enum the
 * running process does not accept.
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

/** Writes each absent family to the process log, with what it costs. */
export class LoggedApiPackagedRestAbsence extends ApiPackagedRestAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiPackagedRestAbsence {
    return new LoggedApiPackagedRestAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(family: ApiPackagedRestFamilyName): void {
    this.logger.warn(
      { family },
      CONSEQUENCE[family] ??
        `API process composed no service for the ${family} REST family: it is not mounted.`,
    );
  }
}

const CONSEQUENCE: Partial<Record<ApiPackagedRestFamilyName, string>> = {
  "user-avatar":
    "API process serves no /api/user-avatar: it composed no stored-object read, or no dual-credential verifier for the browser to load an image with. Every member list, annotation and presence bar falls back to initials rather than the photo a person uploaded.",
  "tracked-events":
    "API process serves neither /api/events/track nor /api/track_event: recording a feedback event needs the trace command queue this process did not register, and a door mounted without one would answer 200 to a rating it then dropped.",
  copilotkit:
    "API process serves no /api/copilotkit: the prompt-studio adapter it dispatches through reaches the retired studio post-event module, the platform Lambda runtime and a browser package, none of which a server composition may hold.",
};
