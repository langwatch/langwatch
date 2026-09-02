/**
 * The REST families that live in a FEATURE PACKAGE, mounted one at a time from
 * the services this process actually composed.
 *
 * The platform application mounted all of these through a single all-or-nothing
 * enumeration over thirty-two product services. `apps/api` composes most of
 * those now but not every one, and a family whose service is missing must be
 * absent rather than mounted over a throwing stub — a route that exists and
 * answers 500 is worse than one that is honestly not there. So each entry below
 * is its own condition, and what is left out is named at boot by
 * {@link ApiPackagedRestAbsenceReport}.
 *
 * This is still ONE list, iterated once, spread into
 * `createApiProcessRestFeatures`. That matters for more than tidiness: a family
 * reaches the route-policy registry when it is BUILT, and the registry is what
 * the route-authorization audit reads, so a family served from anywhere but an
 * enumeration would drop silently out of that audit while still serving traffic.
 */
import type { AgentApp, AgentPlatformUrlBuilder } from "@langwatch/agent-server";
import { createAgentLegacyRestApp } from "@langwatch/agent-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type {
  AppRestBroadcast,
  AppRestManagementAuditPort,
  AppRestRbacVocabulary,
  AppRestSecurity,
  MountableRestApp,
  PlatformUrlBuilder,
} from "@langwatch/api/rest";
import { bodyLimit } from "@langwatch/api/rest";
import {
  AutomationApp,
  createSlackTriggerRestApp,
  createTriggerRestApp,
} from "@langwatch/automation-server";
import type { AuthzGrantsService, AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { createRoleBindingsRestApp } from "@langwatch/authz-server";
import type { CodingAgentApp, CodingAgentRestAuditPort } from "@langwatch/coding-agent-server";
import { createCodingAgentRestApp } from "@langwatch/coding-agent-server";
import type { DashboardApp } from "@langwatch/dashboard-server";
import { createDashboardsRestApp, createGraphsRestApp } from "@langwatch/dashboard-server";
import type { DatasetApp, DatasetDirectUploadAuthorizer } from "@langwatch/dataset-server";
import { createDatasetRestApp } from "@langwatch/dataset-server";
import type { GovernanceApp, ScimApp, WebhookApp } from "@langwatch/enterprise-api";
import {
  createGovernanceRestApp,
  createScimTokensRestApp,
  createWebhookRestApp,
} from "@langwatch/enterprise-api";
import type { EnterpriseFeature } from "@langwatch/enterprise-plan-gate";
import type { EvaluatorApp } from "@langwatch/evaluator-server";
import { createEvaluatorsRestApp } from "@langwatch/evaluator-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import { createExperimentsRestApp } from "@langwatch/experiment-server";
import type { MonitorApp } from "@langwatch/monitor-server";
import { createMonitorRestApp } from "@langwatch/monitor-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  createModelDefaultsRestApp,
  createModelProvidersRestApp,
} from "@langwatch/model-provider-server";
import type {
  OrganizationLedgerActor,
  OrganizationService,
} from "@langwatch/organization-contract";
import type { OrganizationProvisioningPort } from "@langwatch/organization-server";
import {
  createGroupRestApp,
  createOrganizationsRestApp,
  createTeamsRestApp,
} from "@langwatch/organization-server";
import type { ProjectService } from "@langwatch/project-contract";
import { createProjectRestApp } from "@langwatch/project-server";
import type { RoleService } from "@langwatch/role-contract";
import { createRolesRestApp } from "@langwatch/role-server";
import type {
  ScenarioService,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import type {
  InlineMediaExtraction,
  ScenarioRunPlatformUrlBuilder,
} from "@langwatch/scenario-server";
import {
  createScenarioEventsRestApp,
  createScenariosRestApp,
  createSimulationRunsRestApp,
} from "@langwatch/scenario-server";
import type { SecretApp } from "@langwatch/secret-server";
import type {
  FilesProjectPermissionCheck,
  FilesRateLimiter,
  StoredObjectApp,
} from "@langwatch/stored-object-server";
import { createFilesRestApp } from "@langwatch/stored-object-server";
import type { SuiteApp } from "@langwatch/suite-server";
import { createSuiteRestApp } from "@langwatch/suite-server";
import { createMeRestApp } from "@langwatch/user-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { WorkflowEvaluationTrigger } from "@langwatch/workflow-server";
import { createWorkflowsRestApp } from "@langwatch/workflow-server";
import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";

import type { ApiErrorBody } from "@langwatch/api/rest";

import {
  type AgentCacheStore,
  createAgentCacheRestApp,
} from "../features/agent-cache/agent-cache-rest";
import { createSecretLegacyRestApp } from "../features/secret/secret-legacy-rest";

/**
 * The product services this process may or may not have composed.
 *
 * Each is a provider for the same reason the process list's are: mounting a
 * family must not force its service to be constructed, which is what lets the
 * route-registry audits build every family without a running process.
 */
export type ApiPackagedRestServices = Readonly<{
  /** The per-project expiring entry store the agent cache reads and writes. */
  agentCache?: (() => AgentCacheStore) | undefined;
  /** The deprecated `/api/agents` family's read/write capability. */
  agents?: (() => AgentApp) | undefined;
  apiKeys?: (() => ApiKeyService) | undefined;
  /** Writing role bindings: the grants ledger `/api/role-bindings` appends to. */
  authzGrants?: (() => AuthzGrantsService) | undefined;
  automation?: (() => AutomationApp) | undefined;
  /** Fan-out to every browser watching one tenant. */
  broadcast?: (() => AppRestBroadcast) | undefined;
  /** The coding-agent reads, plus the cross-project cuts they answer over. */
  codingAgents?: (() => CodingAgentApp) | undefined;
  /** Records who read an answer that names people. REST audits; tRPC does not. */
  codingAgentAudit?: (() => CodingAgentRestAuditPort) | undefined;
  dashboard?: (() => DashboardApp) | undefined;
  datasets?: (() => DatasetApp) | undefined;
  evaluators?: (() => EvaluatorApp) | undefined;
  experiments?: (() => ExperimentApp) | undefined;
  governance?: (() => GovernanceApp) | undefined;
  modelProviders?: (() => ModelProviderService) | undefined;
  monitors?: (() => MonitorApp) | undefined;
  /** The organization directory `/api/groups`, `/api/teams` and `/api/me` read. */
  organizations?: (() => OrganizationService) | undefined;
  /**
   * The SAME directory in the shape `/api/organizations` takes.
   *
   * Held apart from the entry above because instance provisioning creates a
   * tenant BEFORE any credential for it exists, which the canonical contract
   * does not declare — so a process can serve the directory without serving
   * the provisioning door.
   */
  organizationProvisioning?: (() => OrganizationService & OrganizationProvisioningPort) | undefined;
  /** Reading effective permissions and the bindings that confer them. */
  permissions?: (() => AuthzService) | undefined;
  projects?: (() => ProjectService) | undefined;
  /** Custom roles, the Enterprise-gated half of RBAC. */
  roles?: (() => RoleService) | undefined;
  scenarios?: (() => ScenarioService) | undefined;
  scenarioTabs?: (() => ScenarioTabRegistry) | undefined;
  /** The SCIM provisioning tokens an identity provider authenticates with. */
  scim?: (() => ScimApp) | undefined;
  secrets?: (() => SecretApp) | undefined;
  simulations?: (() => SimulationService) | undefined;
  storedObjects?: (() => StoredObjectApp) | undefined;
  suites?: (() => SuiteApp) | undefined;
  /**
   * The webhook platform: endpoints, health, the emitted-events log, the
   * entitlement gate, the test-fire hop and the idempotency ledger.
   */
  webhooks?: (() => WebhookApp) | undefined;
  workflows?: (() => WorkflowService) | undefined;
}>;

/**
 * What these families need from the process that is not a service.
 *
 * The ones this process can always answer are required; the ones it may not be
 * able to compose are optional and take their family off with them. Each
 * optional entry says which family it decides.
 */
export type ApiPackagedRestPorts = Readonly<{
  /** The external UI address of ONE agent's editor drawer. */
  agentPlatformUrl: AgentPlatformUrlBuilder;
  /** The external UI address a read or write links back to. */
  platformUrl: PlatformUrlBuilder;
  /** The external UI address of one simulation run. */
  scenarioRunPlatformUrl: ScenarioRunPlatformUrlBuilder;
  /**
   * Any thrown value as the canonical error envelope, in this process's own
   * taxonomy. A family that installs its own `onError` to log what the caller
   * received delegates the rendering here rather than keeping a second mapping.
   */
  canonicalError: (
    error: unknown,
    c: Context<any>,
  ) => { status: ContentfulStatusCode; body: ApiErrorBody };
  /**
   * Sets the authenticated project's `organization` on the request context.
   * Resolving it reads this process's team graph.
   */
  organizationMiddleware: MiddlewareHandler;
  /** Audit emission for management API writes; the write has already committed. */
  managementAudit: AppRestManagementAuditPort;
  /** Who an organization-authenticated REST write is attributed to (ADR-092). */
  organizationLedgerActor: (c: Context<any>) => OrganizationLedgerActor;
  /** The permission vocabulary custom roles are built from. */
  rbacVocabulary: AppRestRbacVocabulary;
  /** The configured instance administrator credential, or undefined when unset. */
  instanceAdminKey: () => string | undefined;
  /** Whether this deployment is the hosted product rather than self-hosted. */
  isSaas: () => boolean;
  /** A compensation that itself failed: reported, never raised over the original. */
  reportError: (error: Error) => void;
  /** One fixed-window counter, keyed on whatever the caller is identified by. */
  rateLimit: FilesRateLimiter;
  /**
   * Which trace sources a monitor's `mappings` may name.
   *
   * A schema rather than a restatement here, so the request validator and the
   * published document are built from one definition.
   */
  monitorMappingsSchema: ZodType;
  /**
   * The API-key ceiling for one permission, as a middleware. A route needing a
   * SECOND permission beyond its access policy installs one of these.
   */
  requireApiKeyPermission: (permission: AuthzPermission) => MiddlewareHandler;
  /**
   * Refuses ingest once the project's team has spent its plan's allowance.
   *
   * Required rather than optional because a process with no usage meter still
   * has to decide what happens, and this process's answer is the receiver's own
   * long-standing degradation: telemetry a customer already paid to produce is
   * accepted and the absent meter reported at boot.
   */
  traceUsageGuard: MiddlewareHandler;
  /**
   * Refuses `/api/files` and the avatar reads unless the session user holds the
   * permission on the project. Absent takes the files family off — an object
   * read that could not authorize would be a cross-tenant read.
   */
  requireProjectPermission?: FilesProjectPermissionCheck | undefined;
  /**
   * Accepts either a project API key or a browser session on the byte-serving
   * routes, refusing a request carrying both. Absent takes `/api/files` off,
   * for the same reason: the in-app player fires with a cookie and no headers.
   */
  dualAuth?: MiddlewareHandler | undefined;
  /**
   * Refuses a route unless the resolved organization's plan is Enterprise.
   *
   * Absent takes the four gated families off — groups, custom roles, role
   * bindings and SCIM tokens — rather than mounting them ungated: a plan gate
   * that cannot read a plan must not pass.
   */
  enterpriseGate?: ((feature: EnterpriseFeature) => MiddlewareHandler) | undefined;
  /**
   * Authorizes a browser-driven dataset direct upload. Absent takes the whole
   * dataset family off: three of its routes are the upload UI's only door.
   */
  authorizeDatasetDirectUpload?: DatasetDirectUploadAuthorizer | undefined;
  /**
   * Externalises the inline media a reported scenario event carries. Absent
   * takes the scenario-event family off rather than storing a recording inline:
   * a run's audio inlined into a ClickHouse row is the payload this exists to
   * keep out of one.
   */
  extractInlineMedia?: InlineMediaExtraction | undefined;
  /**
   * Starts one evaluation run of a workflow's committed version. Absent, the
   * workflow family still mounts and `/api/workflows/:id/evaluate` refuses by
   * name — the other five routes read and write the graph and are unaffected.
   */
  triggerWorkflowEvaluation: WorkflowEvaluationTrigger;
}>;

/** The collaborators one process hands the packaged families. */
export type ApiPackagedRestCollaborators = Readonly<{
  services: ApiPackagedRestServices;
  ports: ApiPackagedRestPorts;
}>;

/** Which packaged families this process left out, and what each costs. */
export abstract class ApiPackagedRestAbsenceReport {
  abstract absent(family: ApiPackagedRestFamilyName): void;
}

export type ApiPackagedRestFamilyName =
  | "agent-cache"
  | "agents"
  | "coding-agent"
  | "dashboards"
  | "dataset"
  | "evaluators"
  | "experiments"
  | "files"
  | "governance"
  | "groups"
  | "me"
  | "model-providers"
  | "monitors"
  | "organizations"
  | "projects"
  | "role-bindings"
  | "roles"
  | "scenario-events"
  | "scenarios"
  | "scim-tokens"
  | "secret"
  | "simulation-runs"
  | "suites"
  | "teams"
  | "triggers"
  | "user-avatar"
  | "tracked-events"
  | "copilotkit"
  | "webhooks"
  | "workflows";

/**
 * Every packaged family this process can build, in mount order.
 *
 * ORDERING inside this list is free: each family owns a literal first path
 * segment (`/api/agents`, `/api/dataset`, `/api/files`, …) that no sibling
 * here claims. Where the list as a whole sits relative to the process's own
 * families is not free, and `createApiProcessRestFeatures` states that.
 */
export function mountApiPackagedRestFamilies(options: {
  security: AppRestSecurity;
  collaborators: ApiPackagedRestCollaborators;
  report?: ApiPackagedRestAbsenceReport | undefined;
}): MountableRestApp[] {
  const { security, report } = options;
  const { services, ports } = options.collaborators;
  const features: MountableRestApp[] = [];

  /** Pushes the family, or names it in the boot report and leaves it off. */
  const mount = (
    family: ApiPackagedRestFamilyName,
    build: (() => MountableRestApp | MountableRestApp[]) | null,
  ): void => {
    if (!build) {
      report?.absent(family);
      return;
    }
    const built = build();
    features.push(...(Array.isArray(built) ? built : [built]));
  };

  const agentCache = services.agentCache;
  mount(
    "agent-cache",
    agentCache ? () => createAgentCacheRestApp({ security, agentCache }).hono : null,
  );

  const agents = services.agents;
  mount(
    "agents",
    agents
      ? () =>
          createAgentLegacyRestApp({
            security,
            agents,
            agentPlatformUrl: ports.agentPlatformUrl,
          }).hono
      : null,
  );

  const codingAgents = services.codingAgents;
  const codingAgentAudit = services.codingAgentAudit;
  mount(
    "coding-agent",
    codingAgents && codingAgentAudit
      ? () =>
          createCodingAgentRestApp({
            security,
            app: codingAgents,
            audit: codingAgentAudit,
          }).hono
      : null,
  );

  // `/api/dashboards` and `/api/graphs` are one application seen twice, so
  // they travel together: a process holding the dashboards but not the graphs
  // would publish a dashboard whose panels cannot be read.
  const dashboard = services.dashboard;
  mount(
    "dashboards",
    dashboard
      ? () => [
          createDashboardsRestApp({ security, dashboard, platformUrl: ports.platformUrl }).hono,
          createGraphsRestApp({ security, dashboard }).hono,
        ]
      : null,
  );

  const datasets = services.datasets;
  const authorizeDirectUpload = ports.authorizeDatasetDirectUpload;
  mount(
    "dataset",
    datasets && authorizeDirectUpload
      ? () =>
          createDatasetRestApp({
            security,
            app: datasets,
            platformUrl: ports.platformUrl,
            authorizeDirectUpload,
          }).hono
      : null,
  );

  const evaluators = services.evaluators;
  mount(
    "evaluators",
    evaluators
      ? () =>
          createEvaluatorsRestApp({
            security,
            app: evaluators,
            platformUrl: ports.platformUrl,
            organizationMiddleware: ports.organizationMiddleware,
          }).hono
      : null,
  );

  const experiments = services.experiments;
  mount(
    "experiments",
    experiments ? () => createExperimentsRestApp({ security, app: experiments }).hono : null,
  );

  const storedObjects = services.storedObjects;
  const dualAuth = ports.dualAuth;
  const requireProjectPermission = ports.requireProjectPermission;
  mount(
    "files",
    storedObjects && dualAuth && requireProjectPermission
      ? () =>
          createFilesRestApp({
            security,
            app: storedObjects,
            dualAuth,
            requireProjectPermission,
            rateLimit: ports.rateLimit,
          }).hono
      : null,
  );

  const governance = services.governance;
  mount(
    "governance",
    governance ? () => createGovernanceRestApp({ security, app: governance }).hono : null,
  );

  const organizations = services.organizations;
  const enterpriseGate = ports.enterpriseGate;
  mount(
    "groups",
    organizations && enterpriseGate
      ? () =>
          createGroupRestApp({
            security,
            organizations,
            enterpriseGate: enterpriseGate("GROUPS"),
            ledgerActor: ports.organizationLedgerActor,
          }).hono
      : null,
  );

  const projects = services.projects;
  mount(
    "me",
    governance && organizations && projects
      ? () =>
          createMeRestApp({
            security,
            personalUsage: governance,
            organizations,
            projects,
          }).hono
      : null,
  );

  const modelProviders = services.modelProviders;
  mount(
    "model-providers",
    modelProviders && organizations
      ? () => [
          createModelDefaultsRestApp({ security, modelProviders }).hono,
          createModelProvidersRestApp({ security, modelProviders, organizations }).hono,
        ]
      : null,
  );

  const monitors = services.monitors;
  mount(
    "monitors",
    monitors
      ? () =>
          createMonitorRestApp({
            security,
            app: monitors,
            platformUrl: ports.platformUrl,
            mappingsSchema: ports.monitorMappingsSchema,
          }).hono
      : null,
  );

  const organizationProvisioning = services.organizationProvisioning;
  const apiKeys = services.apiKeys;
  mount(
    "organizations",
    organizationProvisioning && apiKeys
      ? () =>
          createOrganizationsRestApp({
            security,
            organizations: organizationProvisioning,
            apiKeys,
            instanceAdminKey: ports.instanceAdminKey,
            isSaas: ports.isSaas,
            audit: ports.managementAudit,
            reportError: ports.reportError,
          }).hono
      : null,
  );

  mount(
    "projects",
    projects && apiKeys ? () => createProjectRestApp({ security, projects, apiKeys }).hono : null,
  );

  const permissions = services.permissions;
  const authzGrants = services.authzGrants;
  mount(
    "role-bindings",
    permissions && authzGrants && enterpriseGate
      ? () =>
          createRoleBindingsRestApp({
            security,
            enterpriseGate: enterpriseGate("MANAGEMENT_API"),
            permissions,
            grants: authzGrants,
            ledgerActor: ports.organizationLedgerActor,
          })
      : null,
  );

  const roles = services.roles;
  mount(
    "roles",
    roles && enterpriseGate
      ? () =>
          createRolesRestApp({
            security,
            enterpriseGate: enterpriseGate("RBAC"),
            roles,
            vocabulary: ports.rbacVocabulary,
            ledgerActor: ports.organizationLedgerActor,
          })
      : null,
  );

  const simulations = services.simulations;
  const scenarioTabs = services.scenarioTabs;
  const broadcast = services.broadcast;
  const extractInlineMedia = ports.extractInlineMedia;
  mount(
    "scenario-events",
    simulations && scenarioTabs && broadcast && extractInlineMedia
      ? () =>
          createScenarioEventsRestApp({
            security,
            simulations,
            scenarioTabs,
            broadcast,
            extractInlineMedia,
            traceUsageGuard: ports.traceUsageGuard,
            bodyLimit,
            platformUrl: ports.platformUrl,
          }).hono
      : null,
  );

  const scenarios = services.scenarios;
  mount(
    "scenarios",
    scenarios
      ? () => createScenariosRestApp({ security, scenarios, platformUrl: ports.platformUrl }).hono
      : null,
  );

  const scim = services.scim;
  mount(
    "scim-tokens",
    scim && enterpriseGate
      ? () =>
          createScimTokensRestApp({
            security,
            enterpriseGate: enterpriseGate("SCIM"),
            app: scim,
            audit: ports.managementAudit,
          })
      : null,
  );

  const secrets = services.secrets;
  mount("secret", secrets ? () => createSecretLegacyRestApp({ security, secrets }).hono : null);

  mount(
    "simulation-runs",
    simulations
      ? () =>
          createSimulationRunsRestApp({
            security,
            simulations,
            scenarioRunPlatformUrl: ports.scenarioRunPlatformUrl,
          }).hono
      : null,
  );

  const suites = services.suites;
  mount(
    "suites",
    suites
      ? () => createSuiteRestApp({ security, suites, platformUrl: ports.platformUrl }).hono
      : null,
  );

  mount(
    "teams",
    organizations && permissions && projects
      ? () =>
          createTeamsRestApp({
            security,
            organizations,
            permissions,
            projects,
            ledgerActor: ports.organizationLedgerActor,
          }).hono
      : null,
  );

  // Both automation doors, mounted together over the SAME application. The
  // narrow `/api/trigger/slack` predates `/api/triggers` and keeps its own
  // path, body spelling and refusal bodies; a process holding one and not the
  // other would let two doors disagree about what a trigger is.
  const automation = services.automation;
  mount(
    "triggers",
    automation
      ? () => [
          createTriggerRestApp({ security, automation, platformUrl: ports.platformUrl }).hono,
          createSlackTriggerRestApp({ security, automation }).hono,
        ]
      : null,
  );

  const webhooks = services.webhooks;
  mount(
    "webhooks",
    webhooks
      ? () =>
          createWebhookRestApp({
            security,
            webhooks,
            canonicalError: ports.canonicalError,
          }).hono
      : null,
  );

  const workflows = services.workflows;
  mount(
    "workflows",
    workflows
      ? () =>
          createWorkflowsRestApp({
            security,
            workflows,
            ports: {
              platformUrl: ports.platformUrl,
              requireApiKeyPermission: ports.requireApiKeyPermission,
              triggerEvaluation: ports.triggerWorkflowEvaluation,
            },
          }).hono
      : null,
  );

  // The two families this process cannot build at all, named here rather than
  // silently missing. `/api/user-avatar` needs the object's OWNER KIND to keep
  // its broad read from serving trace media, and this process's file read
  // answers a row that does not carry one; `/api/events/track` needs the
  // tracked-event span builder, which no package owns.
  report?.absent("user-avatar");
  report?.absent("tracked-events");
  report?.absent("copilotkit");

  return features;
}
