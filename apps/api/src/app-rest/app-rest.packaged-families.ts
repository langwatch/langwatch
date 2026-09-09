/**
 * The REST families that live in a FEATURE PACKAGE, mounted one at a time from the
 * services this process actually composed. The platform application mounted all of these
 * through a single all-or-nothing enumeration over thirty-two product services.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { AgentPlatformUrlBuilder } from "@langwatch/agent-server";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type {
  AppRestBroadcast,
  AppRestManagementAuditPort,
  AppRestSecurity,
  MountableRestApp,
  PlatformUrlBuilder,
  RestErrorHandler,
} from "@langwatch/api/rest";
import type { AutomationApp } from "@langwatch/automation-server";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import type { CodingAgentApp, CodingAgentRestAuditPort } from "@langwatch/coding-agent-server";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApp, DatasetDirectUploadAuthorizer } from "@langwatch/dataset-server";
import type { GovernanceApp, ScimApp, WebhookApp } from "@langwatch/enterprise-api";
import type { EnterpriseFeature } from "@langwatch/enterprise-plan-gate";
import type { EvaluatorApp } from "@langwatch/evaluator-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  OrganizationLedgerActor,
  OrganizationService,
} from "@langwatch/organization-contract";
import type { OrganizationProvisioningPort } from "@langwatch/organization-server";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  ScenarioService,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import type { InlineMediaExtraction } from "@langwatch/scenario-server/api-rest/scenario-event";
import type { ScenarioRunPlatformUrlBuilder } from "@langwatch/scenario-server/api-rest/simulation-run";
import type {
  FilesProjectPermissionCheck,
  FilesRateLimiter,
  StoredObjectApp,
} from "@langwatch/stored-object-server";
import type { TrackedEventPorts } from "@langwatch/trace-server/api-rest/tracked-event";
import type { UserAvatarObjectReader } from "@langwatch/user-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { WorkflowEvaluationTrigger } from "@langwatch/workflow-server";
import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "@langwatch/api/rest";

import { mountDashboardRest } from "../features/dashboard/dashboard-rest.mount.ts";
import { mountEvaluatorRest } from "../features/evaluator/evaluator-rest.mount.ts";
import { mountMonitorRest } from "../features/monitor/monitor-rest.mount.ts";
import { mountStoredObjectFileRest } from "../features/stored-object/stored-object-file-rest.mount.ts";
import type { ApiHandlerManagedCredentialPort } from "./app-rest.process-features.ts";

import type { AgentCacheStore } from "../features/agent-cache/agent-cache-rest.ts";

/**
 * The product services this process may or may not have composed.
 */
export type ApiPackagedRestServices = Readonly<{
  /** The per-project expiring entry store the agent cache reads and writes. */
  agentCache?: (() => AgentCacheStore) | undefined;
  /** The deprecated `/api/agents` family's read/write capability. */
  agents?: (() => AgentApi) | undefined;
  /**
   * The connected-agent transport (ADR-128), layered onto `/api/v1/agents`'s
   * `/connect/*` and `/:id/call` routes. Absent takes those two route groups
   * off; list/create/read/update/archive/test still mount on `agents` alone.
   */
  agentsV1?:
    | (() => {
        connect: { relayMaxPayloadMb?: number };
        call: { relayMaxPayloadMb?: number };
      })
    | undefined;
  apiKeys?: (() => ApiKeyApi) | undefined;
  automation?: (() => AutomationApp) | undefined;
  /** Fan-out to every browser watching one tenant. */
  broadcast?: (() => AppRestBroadcast) | undefined;
  /** The coding-agent reads, plus the cross-project cuts they answer over. */
  codingAgents?: (() => CodingAgentApp) | undefined;
  /** Records who read an answer that names people. REST audits; tRPC does not. */
  codingAgentAudit?: (() => CodingAgentRestAuditPort) | undefined;
  dashboard?: (() => DashboardApi) | undefined;
  datasets?: (() => DatasetApp) | undefined;
  evaluators?: (() => EvaluatorApp) | undefined;
  experiments?: (() => ExperimentApp) | undefined;
  governance?: (() => GovernanceApp) | undefined;
  modelProviders?: (() => ModelProviderService) | undefined;
  monitors?: (() => MonitorApi) | undefined;
  /** The organization directory `/api/groups`, `/api/teams` and `/api/me` read. */
  organizations?: (() => OrganizationService) | undefined;
  /**
   * The SAME directory in the shape `/api/organizations` takes.
   */
  organizationProvisioning?: (() => OrganizationService & OrganizationProvisioningPort) | undefined;
  /** Reading effective permissions and the bindings that confer them. */
  permissions?: (() => AuthzService) | undefined;
  projects?: (() => ProjectService) | undefined;
  scenarios?: (() => ScenarioService) | undefined;
  scenarioTabs?: (() => ScenarioTabRegistry) | undefined;
  /** The SCIM provisioning tokens an identity provider authenticates with. */
  scim?: (() => ScimApp) | undefined;
  simulations?: (() => SimulationService) | undefined;
  storedObjects?: (() => StoredObjectApp) | undefined;
  /**
   * One avatar object's metadata and bytes, for `/api/user-avatar`.
   */
  userAvatarObjects?: (() => UserAvatarObjectReader) | undefined;
  /**
   * Recording a customer's feedback event as the one span that carries it, plus the
   * second validation pass, the id, the error sink and the rendered rejection the
   * family's two URLs need.
   */
  trackedEvents?: (() => TrackedEventPorts) | undefined;
  /**
   * The webhook platform: endpoints, health, the emitted-events log, the
   * entitlement gate, the test-fire hop and the idempotency ledger.
   */
  webhooks?: (() => WebhookApp) | undefined;
  workflows?: (() => WorkflowService) | undefined;
}>;

/**
 * What these families need from the process that is not a service. The ones this process
 * can always answer are required; the ones it may not be able to compose are optional and
 * take their family off with them. Each optional entry says which family it decides.
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
  /** The process's own error envelope, which every declared family answers in. */
  legacyErrors: RestErrorHandler;
  /** The configured instance administrator credential, or undefined when unset. */
  instanceAdminKey: () => string | undefined;
  /** Whether this deployment is the hosted product rather than self-hosted. */
  isSaas: () => boolean;
  /** A compensation that itself failed: reported, never raised over the original. */
  reportError: (error: Error) => void;
  /** One fixed-window counter, keyed on whatever the caller is identified by. */
  rateLimit: FilesRateLimiter;
  /**
   * Resolves a project API key and enforces one permission as a key ceiling.
   * The declared families bind their own identity through it rather than
   * through the security object the hand-written ones take.
   */
  handlerManagedCredential: ApiHandlerManagedCredentialPort;
  /**
   * The API-key ceiling for one permission, as a middleware. A route needing a
   * SECOND permission beyond its access policy installs one of these.
   */
  requireApiKeyPermission: (permission: AuthzPermission) => MiddlewareHandler;
  /**
   * Refuses ingest once the project's team has spent its plan's allowance.
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
   * Refuses a route unless the resolved organization's plan is Enterprise. Absent takes
   * the four gated families off — groups, custom roles, role bindings and SCIM tokens —
   * rather than mounting them ungated: a plan gate that cannot read a plan must not pass.
   */
  enterpriseGate?: ((feature: EnterpriseFeature) => MiddlewareHandler) | undefined;
  /**
   * Authorizes a browser-driven dataset direct upload. Absent takes the whole
   * dataset family off: three of its routes are the upload UI's only door.
   */
  authorizeDatasetDirectUpload?: DatasetDirectUploadAuthorizer | undefined;
  /**
   * Externalises the inline media a reported scenario event carries. Absent takes the
   * scenario-event family off rather than storing a recording inline: a run's audio
   * inlined into a ClickHouse row is the payload this exists to keep out of one.
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
  | "agents-v1"
  | "coding-agent"
  | "coding-agent-v1"
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
  | "scenario-events"
  | "scenarios"
  | "scim-tokens"
  | "simulation-runs"
  | "teams"
  | "triggers"
  | "user-avatar"
  | "tracked-events"
  | "webhooks"
  | "workflows";

/**
 * Every packaged family this process can build, in mount order. ORDERING inside this list
 * is free: each family owns a literal first path segment (`/api/agents`, `/api/dataset`,
 * `/api/files`, …) that no sibling here claims.
 */
export function mountApiPackagedRestFamilies(options: {
  /**
   * The process's REST security seam. Read by no family here today: the four
   * that mount are declared families, which bind a credential instead. It
   * stays on the signature because a hand-written family took it.
   */
  security: AppRestSecurity;
  collaborators: ApiPackagedRestCollaborators;
  report?: ApiPackagedRestAbsenceReport | undefined;
}): MountableRestApp[] {
  const { report } = options;
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

  // Every family below whose transport still names a deleted REST builder is
  // left off and named once at boot, whatever service this process composed
  // for it. Each returns when its own flat declaration lands.
  mount("agent-cache", null);

  // The agent REST families are unconverted: mounted nothing until their
  // flat declarations exist (plan section 4).
  mount("agents", null);

  // `/api/v1/agents`: the same application as the deprecated family above,
  // plus ADR-128's connected-agent routes when this process composed that
  // transport (`agentsV1`, absent leaves `/connect/*` and `/:id/call` off).
  mount("agents-v1", null);

  mount("coding-agent", null);

  // The same rollup asked at the ORGANIZATION: one route, its own base path,
  // and an organization credential instead of a project one. A separate family
  // because the scope a family authenticates at is the family's, not a route's
  // — mounting an organization-keyed route inside the project family would
  // make every route in it answer to two different credentials.
  mount("coding-agent-v1", null);

  // `/api/dashboards` and `/api/graphs` are one application seen twice, so
  // they travel together: a process holding the dashboards but not the graphs
  // would publish a dashboard whose panels cannot be read.
  const dashboard = services.dashboard;
  mount(
    "dashboards",
    dashboard
      ? () => mountDashboardRest({ dashboard, credential: ports.handlerManagedCredential })
      : null,
  );

  // `/api/dataset` is converted: the family is declared by the module and
  // mounted from the dataset feature's own composition, not from here.
  mount("dataset", null);

  const evaluators = services.evaluators;
  mount(
    "evaluators",
    evaluators
      ? () =>
          mountEvaluatorRest({
            evaluators,
            credential: ports.handlerManagedCredential,
            platformUrl: ports.platformUrl,
            errors: ports.legacyErrors,
          })
      : null,
  );

  mount("experiments", null);

  // `/api/files` reads bytes a page renders and a key fetches, so it needs
  // BOTH doors: the dual-credential verifier and the person's project
  // permission. Either absent takes the family off rather than serving an
  // object read that could not authorize.
  const storedObjects = services.storedObjects;
  const requireProjectPermission = ports.requireProjectPermission;
  const dualAuth = ports.dualAuth;
  mount(
    "files",
    storedObjects && requireProjectPermission && dualAuth
      ? () =>
          mountStoredObjectFileRest({
            storedObjects,
            dualAuth,
            requireProjectPermission,
            rateLimit: ports.rateLimit,
            errors: ports.legacyErrors,
          })
      : null,
  );

  mount("governance", null);

  mount("groups", null);

  mount("me", null);

  mount("model-providers", null);

  const monitors = services.monitors;
  mount(
    "monitors",
    monitors
      ? () =>
          mountMonitorRest({
            monitors,
            credential: ports.handlerManagedCredential,
            platformUrl: ports.platformUrl,
            errors: ports.legacyErrors,
          })
      : null,
  );

  mount("organizations", null);

  mount("projects", null);

  mount("scenario-events", null);

  mount("scenarios", null);

  mount("scim-tokens", null);

  mount("simulation-runs", null);

  mount("user-avatar", null);

  mount("teams", null);

  // Both tracked-event doors, mounted together over the SAME ports. `/api/track_event` is
  // the URL every pre-rename SDK release posts to and `/api/events/track` is the
  // canonical one; the legacy app replays the request against the canonical route rather
  // than handling it, so the two cannot answer differently. The alias takes the canonical
  // app as an argument, so neither is mounted while the canonical one is unconverted.
  mount("tracked-events", null);

  // Both automation doors, mounted together over the SAME application. The
  // narrow `/api/trigger/slack` predates `/api/triggers` and keeps its own
  // path, body spelling and refusal bodies; a process holding one and not the
  // other would let two doors disagree about what a trigger is.
  mount("triggers", null);

  mount("webhooks", null);

  mount("workflows", null);

  return features;
}
