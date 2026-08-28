import type { LegacyAgentsRestApi } from "@langwatch/agent-server/legacy-rest";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AutomationService } from "@langwatch/automation-contract";
import type { AuthzGrantsService, AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import type { DashboardService } from "@langwatch/dashboard-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { EnterpriseFeature } from "@langwatch/enterprise-plan-gate";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  OrganizationLedgerActor,
  OrganizationService,
} from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { RoleService } from "@langwatch/role-contract";
import type {
  ScenarioService,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import type {
  StoredObjectOwnerResolver,
  StoredObjectService,
} from "@langwatch/stored-object-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { SuiteService } from "@langwatch/suite-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { z, type ZodType } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  type AgentCacheStore,
  createAgentCacheRestApp,
} from "../features/agent-cache/agent-cache-rest";
import {
  type AgentPlatformUrlBuilder,
  createAgentLegacyRestApp,
} from "../features/agent/agent-legacy-rest";
import { createApiKeysRestApp } from "../features/api-key/api-keys-rest";
import { createTriggerRestApp } from "../features/automation/trigger-rest";
import { createRoleBindingsRestApp } from "../features/authz/role-bindings-rest";
import {
  type CodingAgentRestServices,
  createCodingAgentRestApp,
} from "../features/coding-agent/coding-agent-rest";
import {
  type CopilotServiceAdapterFactory,
  createCopilotKitRestApp,
} from "../features/copilotkit/copilotkit-rest";
import { createDashboardsRestApp } from "../features/dashboard/dashboard-rest";
import {
  createDatasetRestApp,
  type DatasetDirectUploadAuthorizer,
} from "../features/dataset/dataset-rest";
import { createScimTokensRestApp } from "../features/enterprise-scim/scim-tokens-rest";
import { createEvaluatorsRestApp } from "../features/evaluator/evaluator-rest";
import { createExperimentsRestApp } from "../features/experiment/experiment-rest";
import { createGovernanceRestApp } from "../features/governance/governance-rest";
import { createGraphsRestApp } from "../features/graphs/graphs-rest";
import { createMonitorRestApp } from "../features/monitor/monitor-rest";
import { createGatewayPlatformRestApp } from "../features/gateway/gateway-platform-rest";
import type { GatewayPlatformRestPorts } from "../features/gateway/gateway-platform-rest.ports";
import { createGatewaySpendRestApp } from "../features/gateway/gateway-spend-rest";
import type { GatewaySpendRestPorts } from "../features/gateway/gateway-spend-rest.ports";
import { createEventsRestApp, type TrackedEventPorts } from "../features/trace/events-rest";
import { createModelDefaultsRestApp } from "../features/model-defaults/model-defaults-rest";
import { createModelProvidersRestApp } from "../features/model-provider/model-provider-rest";
import { createGroupRestApp } from "../features/organization/group-rest";
import {
  createOrganizationsRestApp,
  type OrganizationProvisioningPort,
} from "../features/organization/organizations-rest";
import { createTeamsRestApp } from "../features/organization/teams-rest";
import { createProjectRestApp } from "../features/project/project-rest";
import { createRolesRestApp } from "../features/role/roles-rest";
import { createMeRestApp, type MeRestTeamOrganizationLookup } from "../features/user/me-rest";
import {
  createUserAvatarRestApp,
  type UserAvatarObjectReader,
} from "../features/user/user-avatar-rest";
import {
  createWorkflowsRestApp,
  type WorkflowEvaluationTrigger,
} from "../features/workflow/workflow-rest";
import {
  createScenarioEventsRestApp,
  type InlineMediaExtraction,
} from "../features/scenario/scenario-event-rest";
import { createScenariosRestApp } from "../features/scenario/scenario-rest";
import {
  createSimulationRunsRestApp,
  type ScenarioRunPlatformUrlBuilder,
} from "../features/scenario/simulation-run-rest";
import {
  createFilesRestApp,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
} from "../features/stored-object/files-rest";
import { createSecretLegacyRestApp } from "../features/secret/secret-legacy-rest";
import { createSuiteRestApp } from "../features/suite/suite-rest";
import { createWebhookRestApp, type WebhookRestServices } from "../features/webhook/webhook-rest";
import type { ApiErrorBody } from "./app-rest.schemas";
import type { AppRestBroadcast } from "./app-rest.broadcast";
import type { AppRestManagementAuditPort } from "./app-rest.management-audit";
import type { PlatformUrlBuilder } from "./app-rest.platform-url";
import type { AppRestRbacVocabulary } from "./app-rest.rbac-vocabulary";
import type { AppRestSecurity } from "./app-rest.security";

/**
 * The capabilities the REST families this package owns dispatch through.
 *
 * Each is a provider rather than an instance: mounting a family must not force
 * its service to be constructed, which is what lets the OpenAPI generator and
 * the route-registry audits build every family without a running process.
 */
export interface AppRestFeatureServices {
  /** The per-project expiring entry store the agent cache reads and writes. */
  agentCache: () => AgentCacheStore;
  /** The deprecated `/api/agents` family's read/write capability. */
  agents: () => LegacyAgentsRestApi;
  apiKeys: () => ApiKeyService;
  /** Writing role bindings: the grants ledger `/api/role-bindings` appends to. */
  authzGrants: () => AuthzGrantsService;
  automation: () => AutomationService;
  /** Fan-out to every browser watching one tenant. */
  broadcast: () => AppRestBroadcast;
  dashboard: () => DashboardService;
  datasets: () => DatasetService;
  evaluators: () => EvaluatorService;
  experiments: () => ExperimentService;
  /**
   * The AI Gateway control plane's capabilities and the per-scope decisions
   * its writes are authorized against, in ONE bag: it is the same seam the
   * gateway's tRPC transports take, so the two doors cannot drift apart.
   */
  gatewayPlatform: () => GatewayPlatformRestPorts;
  /** The spend ledger, the webhook replay path, and the spend-scope resolver. */
  gatewaySpend: () => GatewaySpendRestPorts;
  governance: () => GovernanceService;
  /** The coding-agent reads, plus the cross-project cuts they answer over. */
  codingAgents: () => CodingAgentRestServices;
  modelProviders: () => ModelProviderService;
  monitors: () => MonitorService;
  /**
   * The organization capability, WIDER than the published contract.
   *
   * Two families reach past it. `/api/me` resolves the organization behind a
   * personal workspace from its team, and `/api/organizations` provisions an
   * organization before any credential for it exists — neither is on
   * `OrganizationService` today, so each family names what it calls and the
   * intersection is what a process has to supply. Both belong on the contract;
   * moving them there is a change to the organization package, not to this
   * enumeration.
   */
  organizations: () => OrganizationService &
    MeRestTeamOrganizationLookup &
    OrganizationProvisioningPort;
  /** Reading effective permissions and the bindings that confer them. */
  permissions: () => AuthzService;
  projects: () => ProjectService;
  /** Custom roles, the Enterprise-gated half of RBAC. */
  roles: () => RoleService;
  scenarios: () => ScenarioService;
  scenarioTabs: () => ScenarioTabRegistry;
  /** The SCIM provisioning tokens an identity provider authenticates with. */
  scim: () => ScimService;
  secrets: () => SecretService;
  simulations: () => SimulationService;
  storedObjectOwners: () => StoredObjectOwnerResolver;
  storedObjects: () => StoredObjectService;
  suites: () => SuiteService;
  /** The avatar bytes `/api/user-avatar` serves, by project and object id. */
  userAvatarObjects: () => UserAvatarObjectReader;
  /** The webhook platform: endpoints, health, the emitted-events log, the
   *  entitlement gate, the test-fire hop and the idempotency ledger. */
  webhooks: () => WebhookRestServices;
  workflows: () => WorkflowService;
}

/**
 * What these families need from the process that is not a service.
 *
 * Each entry is a decision the application still owns: which plans entitle a
 * capability, and how a REST write is attributed in the grants ledger. Neither
 * can be resolved inside a transport package — the first reads the
 * deployment's billing store, the second the credential the process's own
 * authentication resolved — so the process supplies them once, the same way it
 * supplies the security spine.
 */
export interface AppRestFeaturePorts {
  /** The external UI address of ONE agent's editor drawer. */
  agentPlatformUrl: AgentPlatformUrlBuilder;
  /**
   * The prompt-studio adapter `/api/copilotkit` runs one project's runtime
   * through. It composes the workflow studio, the NLP runtime and the
   * project's model providers, none of which this transport owns.
   */
  copilotServiceAdapterFor: CopilotServiceAdapterFactory;
  /**
   * Which trace sources a monitor's `mappings` may name.
   *
   * The trace vertical owns that vocabulary, derived from the mapper table it
   * owns, so it arrives as a schema rather than being restated here: the
   * request validator and the published document are then built from the one
   * definition the application enforces.
   */
  monitorMappingsSchema: ZodType;
  /**
   * Authorizes a browser-driven dataset direct upload.
   *
   * These routes are driven by the in-app upload UI, which authenticates with
   * a session cookie rather than an API key, so they resolve the caller inside
   * the handler — which reads sessions, API keys and role bindings out of the
   * application's database.
   */
  authorizeDatasetDirectUpload: DatasetDirectUploadAuthorizer;
  /**
   * Accepts either a project API key or a browser session on the byte-serving
   * routes, and refuses a request carrying both. Browsers fire
   * `<audio src="/api/files/:id">` with the cookie and no custom headers, so a
   * key-only chain would 401 the in-app player.
   */
  dualAuth: MiddlewareHandler;
  /**
   * Any thrown value as the canonical error envelope, in the application's own
   * taxonomy. A family that installs its own `onError` to log what the caller
   * received delegates the rendering here rather than keeping a second
   * mapping of its own.
   */
  canonicalError: (
    error: unknown,
    c: Context<any>,
  ) => { status: ContentfulStatusCode; body: ApiErrorBody };
  /**
   * Refuses every billing-reconciliation route unless the organization's plan
   * includes the billing events API (ADR-072: pull and push gate together).
   */
  gatewaySpendBillingGate: MiddlewareHandler;
  /**
   * Sets the authenticated project's `organization` on the request context.
   * Resolving it reads the application's team graph.
   */
  organizationMiddleware: MiddlewareHandler;
  /**
   * Refuses a route unless the resolved organization's plan is Enterprise,
   * naming which capability was asked for.
   *
   * One port for every gated family rather than one per family: the four that
   * gate today — groups, custom roles, the management API and SCIM — differ
   * only in the capability they name, and a per-family port would make the
   * fifth a change to this interface instead of a change to one call. The
   * process binds it once, to the organization its authentication resolved and
   * the deployment's plan lookup, and it stays fail-closed: a lookup that
   * rejects refuses the request rather than admitting it.
   *
   * Mount it after authentication and after the RBAC check — "you don't have
   * access" beats "your plan doesn't include this" — which is what each family
   * does with the middleware this returns.
   */
  enterpriseGate: (feature: EnterpriseFeature) => MiddlewareHandler;
  /**
   * The configured instance administrator credential, or undefined when unset
   * or blank. Read per request, so a deployment that sets it after boot is
   * honoured.
   */
  instanceAdminKey: () => string | undefined;
  /**
   * Whether this deployment is the hosted product rather than self-hosted.
   * The instance-provisioning family does not exist on SaaS, where an
   * organization is created through signup and billing instead.
   */
  isSaas: () => boolean;
  /**
   * Audit emission for management API writes. The write has already committed
   * when this is called, so the process owns the swallow and the port answers
   * nothing.
   */
  managementAudit: AppRestManagementAuditPort;
  /** Who an organization-authenticated REST write is attributed to (ADR-092). */
  organizationLedgerActor: (c: Context<any>) => OrganizationLedgerActor;
  /**
   * The permission vocabulary custom roles are built from. Read when the
   * `/api/roles` family is BUILT — its write schemas and its published
   * catalogue are both derived from it — so this one is never absent.
   */
  rbacVocabulary: AppRestRbacVocabulary;
  /**
   * A compensation that itself failed, reported and never raised: the caller
   * must still see the ORIGINAL failure.
   */
  reportError: (error: Error) => void;
  /** The external UI address a read or write links back to. */
  platformUrl: PlatformUrlBuilder;
  /**
   * Caps a request body at `maxSize` bytes, refusing anything larger with 413.
   *
   * The application's own middleware rather than Hono's: measuring a chunked
   * upload means draining it and handing it back, and only the process knows
   * which `Request` constructor its Node bridge installed.
   */
  bodyLimit: (options: { maxSize: number }) => MiddlewareHandler;
  /**
   * Externalises the inline media a reported scenario event carries. Owned by
   * the stored-objects vertical, and already bound to its content-addressed
   * store.
   */
  extractInlineMedia: InlineMediaExtraction;
  /** The external UI address of one simulation run. */
  scenarioRunPlatformUrl: ScenarioRunPlatformUrlBuilder;
  /** One fixed-window counter, keyed on whatever the caller is identified by. */
  rateLimit: FilesRateLimiter;
  /** Refuses a read unless the session user holds the permission on the project. */
  requireProjectPermission: FilesProjectPermissionCheck;
  /** Refuses ingest once the project's team has spent its plan's allowance. */
  traceUsageGuard: MiddlewareHandler;
  /**
   * The API-key ceiling for one permission, as a middleware. A route that
   * needs a SECOND permission beyond its access policy installs one of these:
   * `/api/workflows/:id/evaluate` starts a run the caller then has to read, so
   * a workflows-only key is refused up front rather than at the poll.
   */
  requireApiKeyPermission: (permission: AuthzPermission) => MiddlewareHandler;
  /**
   * Starts one evaluation run of a workflow's committed version through the
   * application's evaluations pipeline, answering with the run or a refusal.
   */
  triggerWorkflowEvaluation: WorkflowEvaluationTrigger;
  /**
   * Recording a tracked event: the predefined-payload check, the id, the span
   * dispatch, the error sink and the validation prose. All five reach the
   * application's trace-processing pipeline or its own error vocabulary.
   */
  trackedEvents: TrackedEventPorts;
}

/**
 * Every REST family this package owns, built against one process's security.
 *
 * The one list. A route family reaches the route-policy registry when it is
 * built, and the registry is what the route-authorization audit and the Langy
 * permission suites read — so a second enumeration anywhere would let a family
 * drop silently out of an audit while still serving traffic. Mount them by
 * iterating this, and read them the same way.
 */
export function createAppRestFeatures(options: {
  security: AppRestSecurity;
  services: AppRestFeatureServices;
  ports: AppRestFeaturePorts;
}): MountableRestApp[] {
  const { security, services, ports } = options;
  return [
    createAgentCacheRestApp({ security, agentCache: services.agentCache }).hono,
    createApiKeysRestApp({
      security,
      apiKeys: services.apiKeys,
      permissions: services.permissions,
      audit: ports.managementAudit,
    }).hono,
    createGovernanceRestApp({
      security,
      governance: services.governance,
      projects: services.projects,
    }).hono,
    createDashboardsRestApp({
      security,
      dashboard: services.dashboard,
      platformUrl: ports.platformUrl,
    }).hono,
    createDatasetRestApp({
      security,
      dataset: services.datasets,
      platformUrl: ports.platformUrl,
      authorizeDirectUpload: ports.authorizeDatasetDirectUpload,
    }).hono,
    createEventsRestApp({ security, ports: ports.trackedEvents }).hono,
    createFilesRestApp({
      security,
      storedObjects: services.storedObjects,
      storedObjectOwners: services.storedObjectOwners,
      dualAuth: ports.dualAuth,
      requireProjectPermission: ports.requireProjectPermission,
      rateLimit: ports.rateLimit,
    }).hono,
    createEvaluatorsRestApp({
      security,
      evaluators: services.evaluators,
      modelProviders: services.modelProviders,
      platformUrl: ports.platformUrl,
      organizationMiddleware: ports.organizationMiddleware,
    }).hono,
    createExperimentsRestApp({ security, experiments: services.experiments }).hono,
    createGatewayPlatformRestApp({ security, gateway: services.gatewayPlatform }).hono,
    createGatewaySpendRestApp({
      security,
      billingPlanGate: ports.gatewaySpendBillingGate,
      canonicalError: ports.canonicalError,
      spend: services.gatewaySpend,
    }).hono,
    createGraphsRestApp({ security, dashboard: services.dashboard }).hono,
    createAgentLegacyRestApp({
      security,
      agents: services.agents,
      agentPlatformUrl: ports.agentPlatformUrl,
    }).hono,
    createCodingAgentRestApp({ security, codingAgents: services.codingAgents }).hono,
    createCopilotKitRestApp({
      security,
      serviceAdapterFor: ports.copilotServiceAdapterFor,
    }).hono,
    createMonitorRestApp({
      security,
      monitors: services.monitors,
      platformUrl: ports.platformUrl,
      mappingsSchema: ports.monitorMappingsSchema,
    }).hono,
    createSecretLegacyRestApp({ security, secrets: services.secrets }).hono,
    createTriggerRestApp({
      security,
      automation: services.automation,
      platformUrl: ports.platformUrl,
    }).hono,
    createWebhookRestApp({
      security,
      webhooks: services.webhooks,
      canonicalError: ports.canonicalError,
    }).hono,
    createScenarioEventsRestApp({
      security,
      simulations: services.simulations,
      scenarioTabs: services.scenarioTabs,
      broadcast: services.broadcast,
      extractInlineMedia: ports.extractInlineMedia,
      traceUsageGuard: ports.traceUsageGuard,
      bodyLimit: ports.bodyLimit,
      platformUrl: ports.platformUrl,
    }).hono,
    createScenariosRestApp({
      security,
      scenarios: services.scenarios,
      platformUrl: ports.platformUrl,
    }).hono,
    createSimulationRunsRestApp({
      security,
      simulations: services.simulations,
      scenarioRunPlatformUrl: ports.scenarioRunPlatformUrl,
    }).hono,
    createSuiteRestApp({
      security,
      suites: services.suites,
      scenarios: services.scenarios,
      projects: services.projects,
      platformUrl: ports.platformUrl,
    }).hono,
    createGroupRestApp({
      security,
      organizations: services.organizations,
      enterpriseGate: ports.enterpriseGate("GROUPS"),
      ledgerActor: ports.organizationLedgerActor,
    }).hono,
    createMeRestApp({
      security,
      governance: services.governance,
      organizations: services.organizations,
      projects: services.projects,
    }).hono,
    createOrganizationsRestApp({
      security,
      organizations: services.organizations,
      apiKeys: services.apiKeys,
      instanceAdminKey: ports.instanceAdminKey,
      isSaas: ports.isSaas,
      audit: ports.managementAudit,
      reportError: ports.reportError,
    }).hono,
    createTeamsRestApp({
      security,
      organizations: services.organizations,
      permissions: services.permissions,
      projects: services.projects,
      ledgerActor: ports.organizationLedgerActor,
    }).hono,
    createUserAvatarRestApp({
      security,
      dualAuth: ports.dualAuth,
      userAvatarObjects: services.userAvatarObjects,
      rateLimit: ports.rateLimit,
    }).hono,
    createModelDefaultsRestApp({
      security,
      modelProviders: services.modelProviders,
    }).hono,
    createModelProvidersRestApp({
      security,
      modelProviders: services.modelProviders,
      organizations: services.organizations,
    }).hono,
    createProjectRestApp({
      security,
      projects: services.projects,
      apiKeys: services.apiKeys,
    }).hono,
    createWorkflowsRestApp({
      security,
      workflows: services.workflows,
      ports: {
        platformUrl: ports.platformUrl,
        requireApiKeyPermission: ports.requireApiKeyPermission,
        triggerEvaluation: ports.triggerWorkflowEvaluation,
      },
    }).hono,
    // The versioned management families, built on `@langwatch/api`'s service
    // builder rather than on a `SecuredApp`. That builder hands back the Hono
    // app itself, so there is no `.hono` to unwrap — the same mount target by
    // a shorter route, not a different kind of family.
    createRolesRestApp({
      security,
      enterpriseGate: ports.enterpriseGate("RBAC"),
      roles: services.roles,
      vocabulary: ports.rbacVocabulary,
      ledgerActor: ports.organizationLedgerActor,
    }),
    createRoleBindingsRestApp({
      security,
      enterpriseGate: ports.enterpriseGate("MANAGEMENT_API"),
      permissions: services.permissions,
      grants: services.authzGrants,
      ledgerActor: ports.organizationLedgerActor,
    }),
    createScimTokensRestApp({
      security,
      enterpriseGate: ports.enterpriseGate("SCIM"),
      scim: services.scim,
      audit: ports.managementAudit,
    }),
  ];
}

/**
 * A family's Hono app as a mount target.
 *
 * Each family carries its own request-context shape, and Hono's environment
 * parameter is invariant, so no single concrete `Hono<E>` accepts them all.
 * This is the same erasure Hono's own `route()` signature performs on the
 * sub-app it mounts: the parent reads nothing out of the child's environment,
 * so nothing is lost and the caller needs no cast of its own.
 */
export type MountableRestApp = Hono<any, any, any>;

/**
 * Service providers for a caller that only needs the families BUILT, never
 * served: the OpenAPI generator walks route metadata, and the route-registry
 * audits read the policies registered as a route is declared. Neither invokes
 * a handler, so reaching one of these is a bug in that caller rather than a
 * missing wire.
 */
export function servicesUnavailableOffRequestPath(reason: string): AppRestFeatureServices {
  return {
    agentCache: refuse("The agent cache", reason),
    agents: refuse("Agents", reason),
    apiKeys: refuse("API keys", reason),
    authzGrants: refuse("The grants ledger", reason),
    automation: refuse("Automations", reason),
    broadcast: refuse("Broadcast", reason),
    dashboard: refuse("Dashboard", reason),
    datasets: refuse("Datasets", reason),
    evaluators: refuse("Evaluators", reason),
    experiments: refuse("Experiments", reason),
    gatewayPlatform: refuse("The gateway control plane", reason),
    gatewaySpend: refuse("Gateway spend", reason),
    governance: refuse("Governance", reason),
    codingAgents: refuse("Coding agents", reason),
    modelProviders: refuse("Model providers", reason),
    monitors: refuse("Monitors", reason),
    organizations: refuse("Organizations", reason),
    permissions: refuse("Permissions", reason),
    projects: refuse("Projects", reason),
    roles: refuse("Custom roles", reason),
    scenarios: refuse("Scenarios", reason),
    scenarioTabs: refuse("Scenario tabs", reason),
    scim: refuse("SCIM provisioning", reason),
    secrets: refuse("Secrets", reason),
    simulations: refuse("Simulations", reason),
    storedObjectOwners: refuse("Stored object owners", reason),
    storedObjects: refuse("Stored objects", reason),
    suites: refuse("Suites", reason),
    userAvatarObjects: refuse("User avatars", reason),
    webhooks: refuse("Webhooks", reason),
    workflows: refuse("Workflows", reason),
  };
}

/**
 * The same refusal for the ports, for the same callers.
 *
 * A plan gate and an attribution rule only run while a request is being
 * served, so off the request path they are registered and never invoked. Each
 * throws if that assumption is ever wrong, rather than quietly letting an
 * unentitled request through.
 */
export function portsUnavailableOffRequestPath(reason: string): AppRestFeaturePorts {
  const unavailable = (what: string) => new Error(`${what} is not available ${reason}`);
  return {
    agentPlatformUrl: () => {
      throw unavailable("The agent URL builder");
    },
    copilotServiceAdapterFor: () => {
      throw unavailable("The prompt studio adapter");
    },
    // A placeholder SHAPE, never a served one. The two callers that publish
    // or enforce this family's document — the API router and the spec
    // generator — pass the trace vertical's real mapping schema; anything
    // reaching this one is building the route table for an authorization
    // audit, which reads policies and never a schema.
    monitorMappingsSchema: z.unknown(),
    authorizeDatasetDirectUpload: () => {
      throw unavailable("Direct-upload authorization");
    },
    dualAuth: () => {
      throw unavailable("Dual-credential authentication");
    },
    canonicalError: () => {
      throw unavailable("Canonical error rendering");
    },
    gatewaySpendBillingGate: () => {
      throw unavailable("The billing events plan gate");
    },
    enterpriseGate: () => () => {
      throw unavailable("The Enterprise plan gate");
    },
    instanceAdminKey: () => {
      throw unavailable("The instance administrator credential");
    },
    isSaas: () => {
      throw unavailable("The deployment kind");
    },
    managementAudit: () => {
      throw unavailable("Management audit");
    },
    organizationMiddleware: () => {
      throw unavailable("Organization resolution");
    },
    rateLimit: () => {
      throw unavailable("The rate limiter");
    },
    // A real, EMPTY catalogue rather than a refusal. `/api/roles` derives its
    // write schemas from this vocabulary while it is being built, so a
    // throwing stub cannot be built at all — and the callers that reach this
    // provider are enumerating routes for an authorization audit, which reads
    // policies and never a permission list.
    rbacVocabulary: {
      actions: [],
      resources: [],
      isOrganizationExclusive: () => false,
    },
    reportError: () => {
      throw unavailable("Error reporting");
    },
    requireProjectPermission: () => {
      throw unavailable("The project permission check");
    },
    organizationLedgerActor: () => {
      throw unavailable("Ledger attribution");
    },
    platformUrl: () => {
      throw unavailable("The platform URL builder");
    },
    bodyLimit: () => () => {
      throw unavailable("The request body cap");
    },
    extractInlineMedia: () => {
      throw unavailable("Inline media extraction");
    },
    scenarioRunPlatformUrl: () => {
      throw unavailable("The simulation run URL builder");
    },
    traceUsageGuard: () => {
      throw unavailable("The plan usage guard");
    },
    requireApiKeyPermission: () => () => {
      throw unavailable("The API key ceiling");
    },
    triggerWorkflowEvaluation: () => {
      throw unavailable("Workflow evaluation");
    },
    trackedEvents: {
      assertPredefinedEventPayload: () => {
        throw unavailable("Tracked-event validation");
      },
      generateEventId: () => {
        throw unavailable("Tracked-event ids");
      },
      recordTrackedEvent: () => {
        throw unavailable("Tracked-event recording");
      },
      reportError: () => {
        throw unavailable("The tracked-event error sink");
      },
      describeValidationError: () => {
        throw unavailable("Tracked-event validation prose");
      },
    },
  };
}

function refuse<T>(service: string, reason: string): () => T {
  return (): T => {
    throw new Error(`${service} is not available ${reason}`);
  };
}
