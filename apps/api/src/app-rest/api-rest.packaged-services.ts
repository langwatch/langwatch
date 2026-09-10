/**
 * What this process composed for the families that live in a FEATURE PACKAGE:
 * one provider each, plus the ports they read that are the deployment's rather
 * than a module's. The doors are `api-rest.doors.ts`; nothing here mounts.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { AgentPlatformUrlBuilder } from "@langwatch/agent-server";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type {
  AppRestBroadcast,
  AppRestManagementAuditPort,
  PlatformUrlBuilder,
  RestErrorHandler,
} from "@langwatch/api/rest";
import type { AutomationApp } from "@langwatch/automation-server";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApp, DatasetDirectUploadAuthorizer } from "@langwatch/dataset-server";
import type { GovernanceApp, ScimApi, WebhookApp } from "@langwatch/enterprise-api";
import type { EnterpriseFeature } from "@langwatch/enterprise-plan-gate";
import type { EvaluatorApp } from "@langwatch/evaluator-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type {
  OrganizationLedgerActor,
  OrganizationService,
} from "@langwatch/organization-contract";
import type { OrganizationProvisioningPort } from "@langwatch/organization-server";
import type { ProjectManagementDirectory } from "@langwatch/project-server";
import type { ScenarioTabRegistry, SimulationService } from "@langwatch/scenario-contract";
import type {
  InlineMediaExtraction,
  ScenarioRunPlatformUrlBuilder,
  ScenarioService,
} from "@langwatch/scenario-server";
import type {
  FilesProjectPermissionCheck,
  FilesRateLimiter,
  StoredObjectApp,
} from "@langwatch/stored-object-server";
import type { TrackedEventPorts } from "@langwatch/trace-server";
import type { UserApi } from "@langwatch/user-contract";

import type { WorkflowEvaluationTrigger, WorkflowService,} from "@langwatch/workflow-server";
import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "@langwatch/api/rest";

import type { ApiHandlerManagedCredentialPort } from "./api-rest.runtime.ts";

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
  /** The prompt library `/api/prompts` reads and writes. */
  prompts?: (() => PromptApi) | undefined;
  automation?: (() => AutomationApp) | undefined;
  /** Fan-out to every browser watching one tenant. */
  broadcast?: (() => AppRestBroadcast) | undefined;
  /** The coding-agent reads, plus the cross-project cuts they answer over. */
  codingAgents?: (() => CodingAgentApi) | undefined;
  dashboard?: (() => DashboardApi) | undefined;
  datasets?: (() => DatasetApp) | undefined;
  evaluators?: (() => EvaluatorApp) | undefined;
  experiments?: (() => ExperimentApp) | undefined;
  governance?: (() => GovernanceApp) | undefined;
  modelProviders?: (() => ModelProviderApi) | undefined;
  monitors?: (() => MonitorApi) | undefined;
  /** The organization directory `/api/groups`, `/api/teams` and `/api/me` read. */
  organizations?: (() => OrganizationService) | undefined;
  /**
   * The SAME directory in the shape `/api/organizations` takes.
   */
  organizationProvisioning?: (() => OrganizationService & OrganizationProvisioningPort) | undefined;
  /** Reading effective permissions and the bindings that confer them. */
  permissions?: (() => AuthzService) | undefined;
  projects?: (() => ProjectManagementDirectory) | undefined;
  scenarios?: (() => ScenarioService) | undefined;
  scenarioTabs?: (() => ScenarioTabRegistry) | undefined;
  /** The SCIM provisioning tokens an identity provider authenticates with. */
  scim?: (() => ScimApi) | undefined;
  simulations?: (() => SimulationService) | undefined;
  storedObjects?: (() => StoredObjectApp) | undefined;
  /**
   * The signed-in person, for `/api/me` and `/api/user-avatar`. The SAME
   * application the two tRPC namespaces answer from.
   */
  users?: (() => UserApi) | undefined;
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
