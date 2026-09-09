/**
 * The REST families the API process mounts from its OWN graph. This is the ONE list.
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type {
  AppRestManagementAuditPort,
  AppRestSecurity,
  MountableRestApp,
} from "@langwatch/api/rest";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import type { Logger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AdminRestPorts, BugReportRestPorts } from "@langwatch/ops-server";
import type { UnsubscribeRestPorts } from "@langwatch/automation-server";
import type { GithubRestPorts } from "@langwatch/github-server";
import type { AuthCliDeviceFlowRestPorts, AuthRestPorts } from "@langwatch/auth-server";
import type {
  GovernanceCliRestPorts,
  GovernanceIngestRestPorts,
} from "@langwatch/enterprise-governance-server";

import type { ApiScimRestPorts } from "../app/api-scim.composition.ts";

import type { ApiLangyRestComposition } from "../features/langy/langy-rest.mount.ts";

import type { CronRestPorts } from "../features/cron/cron-rest.ts";

import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PromptRestService, PromptTagCatalogAuthorization } from "@langwatch/prompt-server";

import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type {
  OrganizationRestInviteService,
  OrganizationRestService,
} from "@langwatch/organization-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";

import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";

import type { AppRestBroadcast } from "@langwatch/api/rest";
import type { SimulationService } from "@langwatch/scenario-contract";

import type { ApiHandlerManagedSessionPort } from "../app/api-handler-managed-session.ts";
import type { ScenarioRunExportAudit } from "../features/export/scenario-run-export-rest.mount.ts";
import type { ApiTraceExportRestOptions } from "../features/export/trace-export-rest.mount.ts";
import type { ApiLangWatchQLRestCollaborators } from "../features/analytics/langwatch-ql-rest.mount.ts";
import type { ApiAuthoringRestComposition } from "../app/api-authoring-rest.composition.ts";
import type { ApiExperimentV3RestCollaborators } from "../features/experiment/experiment-v3-rest.mount.ts";
import type { ApiExperimentInitRestCollaborators } from "../features/experiment/experiment-init-rest.mount.ts";
import type { ApiWorkflowRunRestCollaborators } from "../features/workflow/workflow-run-rest.mount.ts";
import { mountAnnotationRest } from "../features/annotation/annotation-rest.mount.ts";
import { mountStoredObjectRest } from "../features/stored-object/stored-object-rest.mount.ts";
import {
  mountHealthProbeRest,
  type HealthProbeRestPorts,
} from "../features/health/health-probe-rest.mount.ts";
import type { RumRateLimiter } from "../features/rum/rum-ingest.service.ts";
import type { OtlpIngestRestPorts } from "@langwatch/trace-server/api-rest/otlp-ingest";
import type { CollectorRestPorts } from "@langwatch/trace-server/api-rest/collector";
import type {
  ApiEvaluationBatchRestCollaborators,
  ApiEvaluationRunRestCollaborators,
} from "../features/evaluation/evaluations-legacy-rest.mount.ts";
import type {
  ApiTraceLegacyRestCollaborators,
  ApiTracesRestCollaborators,
} from "../features/trace/trace-rest.mount.ts";
import type { OpsClickHouseExplainRestPorts } from "@langwatch/ops-server";
import type { DspyStepsRestPorts } from "@langwatch/experiment-server";
import type { McpAuthorizeRestPorts } from "@langwatch/hosted-mcp-server";
import {
  mountApiPackagedRestFamilies,
  type ApiPackagedRestAbsenceReport,
  type ApiPackagedRestCollaborators,
} from "./app-rest.packaged-families.ts";

/**
 * The project credential a handler-managed family resolves through.
 *
 * The resolved token travels with the answer because a family that asks a
 * SECOND permission question of its caller — costs, say — has to ask it of the
 * credential and not of whoever holds it.
 */
export type ApiHandlerManagedCredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string }>;
      resolved: ResolvedApiKeyCredential;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>
>;

/**
 * The product services this process may or may not have composed. Each is a
 * provider for the same reason the packaged list's are: mounting a family must
 * not force its service to be constructed.
 */
export type ApiProcessRestServices = Readonly<{
  /** The reviewer's comments `/api/annotations` reads and writes. */
  annotations?: (() => AnnotationApi) | undefined;
  /** The charted reads `/api/analytics/timeseries` answers from. */
  analytics?: (() => AnalyticsApp) | undefined;
  /**
   * The governed-SQL family's collaborators plus the dashboard the saved charts live on,
   * or none.
   */
  langWatchQL?:
    | Readonly<{
        collaborators: ApiLangWatchQLRestCollaborators;
        dashboard: () => DashboardApi;
      }>
    | undefined;
  /**
   * The prompt library `/api/prompts` reads and writes, plus the two things its
   * tag doors need beyond the service: the application's organization-wide tag
   * guard, and the engine that answers whether the CREDENTIAL a request arrived
   * on may act in a sibling project.
   */
  prompts?:
    | Readonly<{
        service: () => PromptRestService;
        tagCatalog: () => PromptTagCatalogAuthorization;
        permissions: () => AuthzService;
      }>
    | undefined;
  /**
   * The organization directory a project-scoped family resolves a tenant through.
   */
  organizations?: (() => Pick<OrganizationService, "getTeamById">) | undefined;
  /**
   * The organization management family's collaborators, or none.
   */
  traceExport?: Omit<ApiTraceExportRestOptions, "security"> | undefined;
  /**
   * The scenario run export's collaborators, or none. All four travel together, and the
   * SESSION is the one that decides: a bulk export is attributable to a person by design,
   * and a process with no browser-session transport cannot name one.
   */
  scenarioRunExport?:
    | Readonly<{
        simulations: () => SimulationService;
        broadcast: () => AppRestBroadcast;
        session: ApiHandlerManagedSessionPort;
        recordExportRequested: ScenarioRunExportAudit;
      }>
    | undefined;
  organizationManagement?:
    | Readonly<{
        organizations: () => OrganizationRestService;
        permissions: () => AuthzService;
        plans: () => PlanProvider;
        shares: () => ShareApi;
        projects: () => ProjectService;
        audit: AppRestManagementAuditPort;
        /**
         * The invitation half, where the process composed one. Absent, the
         * three invitation routes refuse by name rather than listing nothing.
         */
        invites?: (() => OrganizationRestInviteService) | undefined;
        /** The acceptance link an invite carries, from the same service. */
        buildInviteAcceptUrl?: ((inviteCode: string) => string) | undefined;
      }>
    | undefined;
  /**
   * The v1 trace reads' collaborators, or none.
   */
  traceReads?: ApiTracesRestCollaborators | undefined;
  /**
   * The deprecated `/api/trace/*` and `/api/thread/:id` family's collaborators, or none.
   */
  traceLegacy?: ApiTraceLegacyRestCollaborators | undefined;
  /**
   * The four AUTHORING doors a person reaches while editing something — the Studio's code
   * completion and its run dispatch, the playground, the dataset row generator and the
   * scenario author-assist — or none.
   */
  authoring?: ApiAuthoringRestComposition | undefined;
  /**
   * The experiment workbench's ten doors, or none. One entry because the family is one
   * app plus the alias that forwards into it.
   */
  experimentWorkbench?: ApiExperimentV3RestCollaborators | undefined;
  /**
   * The SDK's experiment create-or-take door, or none. Held apart from the workbench's
   * ten even though both live under `/api/experiment*`: this one is an SDK's project key
   * and the workbench's are a browser session and a richer credential.
   */
  experimentInit?: ApiExperimentInitRestCollaborators | undefined;
  /**
   * `POST /api/evaluations/batch/log_results`'s collaborators, or none. None where this
   * process registered no experiment run writer: the rows are a run's history, and a door
   * that accepted them with nowhere to write is one an SDK believes reported its results.
   */
  evaluationBatch?: ApiEvaluationBatchRestCollaborators | undefined;
  /**
   * The four evaluate doors' collaborators, or none. None where this process composed no
   * evaluator RUNTIME.
   */
  evaluationRun?: ApiEvaluationRunRestCollaborators | undefined;
  /**
   * The three URLs a synchronous studio run is started from, or none.
   */
  workflowRun?: ApiWorkflowRunRestCollaborators | undefined;
  /**
   * The families that live in a FEATURE PACKAGE, and the services this process composed
   * for them.
   */
  packaged?: ApiPackagedRestCollaborators | undefined;
  /**
   * The deployment's own liveness report, or none. A mounted family rather
   * than a service: the door is the feature's own mount, already bound to the
   * secret this process reads it under.
   */
  platformHealth?: MountableRestApp | undefined;
  /**
   * The public stored-object family's application, or none. The SAME one
   * `/api/files` reads bytes through, so an object confirmed on one door is
   * the object the other serves.
   */
  storedObjects?: (() => StoredObjectApi) | undefined;
}>;

export type ApiProcessRestPorts = Readonly<{
  /**
   * Resolves a project API key and enforces one permission as a key ceiling,
   * answering the legacy refusal bodies the handler-managed families publish.
   */
  handlerManagedCredential: ApiHandlerManagedCredentialPort;
  /**
   * The process's ONE fixed-window counter. Shared rather than per-family: two
   * instances would give one caller two budgets for the same rule.
   */
  rateLimit: RumRateLimiter;
  /**
   * The OTLP receiver's collaborators, or none.
   */
  otlpIngest?: OtlpIngestRestPorts | undefined;
  /**
   * The SDK collector's collaborators, or none. None for the same reason the OTLP
   * receiver's are: `POST /api/collector` is the other wire into the same ingestion path,
   * and a door that accepts a trace it cannot enqueue tells an SDK the trace landed.
   */
  collector?: CollectorRestPorts | undefined;
  /**
   * The back office's collaborators, or none. Both travel together, and the SESSION is
   * the one that decides: every route here is answered to a signed-in member of instance
   * staff, and a process with no browser-session transport cannot name one.
   */
  admin?: AdminRestPorts | undefined;
  /**
   * The public issue-report intake's collaborators, or none. None when this process
   * composed no database: a report that cannot be written is one a struggling customer
   * believes they filed, which is worse than a door that is honestly not there.
   */
  bugReports?: BugReportRestPorts | undefined;
  /**
   * The one-click unsubscribe door's collaborators, or none. None where this process
   * composed no automation application.
   */
  unsubscribe?: UnsubscribeRestPorts | undefined;
  /**
   * The internal cron family's collaborators, or none. None where this deployment
   * configured no shared cron secret or no sweep to run: a destructive door that
   * cannot authenticate its caller must not exist at all.
   */
  cron?: CronRestPorts | undefined;
  /**
   * The four Langy doors' collaborators, or none. One entry rather than four because they
   * are one graph: the public turn surface and the UI-action surface share a credential
   * chain whose refusal ORDER is the contract, and the two internal doors share a bearer.
   */
  langy?: ApiLangyRestComposition | undefined;
  /**
   * The GitHub App installation flow's collaborators, or none.
   */
  github?: GithubRestPorts | undefined;
  /**
   * The RFC 8628 CLI device grant's collaborators, or none.
   */
  authCliDeviceFlow?: AuthCliDeviceFlowRestPorts | undefined;
  /**
   * The `/api/auth` family's collaborators, or none.
   */
  auth?: AuthRestPorts | undefined;
  /**
   * The CLI governance plane's collaborators, or none.
   */
  governanceCli?: GovernanceCliRestPorts | undefined;
  /**
   * The Activity Monitor's receivers' collaborators, or none. None without both the
   * governance application (which resolves a source's bearer secret) and a trace
   * collection (which is where the spans go).
   */
  governanceIngest?: GovernanceIngestRestPorts | undefined;
  /**
   * The SCIM 2.0 provisioning surface's collaborators, or none. None where this process
   * composed no Enterprise SCIM application.
   */
  scim?: ApiScimRestPorts | undefined;
  /**
   * The deployment's public origin, where it declared one. Deep links on a REST response
   * are built from it.
   */
  publicBaseUrl?: string | undefined;
  /**
   * The five subsystem health probes' collaborators, or none. None where this deployment
   * declared no public origin: every probe sends a canary back through the boundary it is
   * testing, so one with no origin to dial could only ever report on nothing.
   */
  healthProbes?: HealthProbeRestPorts | undefined;
  /**
   * The operator-only ClickHouse EXPLAIN endpoint's collaborators, or none. None where
   * the deployment provisioned no dedicated readonly ClickHouse account or no operator
   * secret.
   */
  opsClickHouseExplain?: OpsClickHouseExplainRestPorts | undefined;
  /**
   * The DSPy optimizer's step log's collaborators, or none.
   */
  dspySteps?: DspyStepsRestPorts | undefined;
  /**
   * The hosted MCP OAuth approval step's collaborators, or none.
   */
  mcpAuthorize?: McpAuthorizeRestPorts | undefined;
  /**
   * The public image relay's egress policy, or none.
   */
  imageProxy?:
    | Readonly<{ blockLocalHttpCalls: boolean; allowedHosts: readonly string[] }>
    | undefined;
}>;

/**
 * Which process-owned families this process left out because their transport is
 * still written against the deleted REST builders, and so cannot be built.
 */
export abstract class ApiProcessRestAbsenceReport {
  abstract unconverted(family: ApiProcessRestFamilyName): void;
}

/** Every process-owned family that is named when it is not mounted. */
export type ApiProcessRestFamilyName =
  | "admin"
  | "analytics"
  | "api-discovery"
  | "api-keys"
  | "auth"
  | "auth-cli-device-flow"
  | "billing-webhook"
  | "bug-reports"
  | "collector"
  | "cron"
  | "dspy-steps"
  | "elevenlabs-webhook"
  | "evaluations-legacy"
  | "experiment-init"
  | "experiment-workbench"
  | "gateway-internal"
  | "gateway-openapi"
  | "gateway-platform"
  | "gateway-spend"
  | "github"
  | "governance-cli"
  | "governance-ingest"
  | "image-proxy"
  | "langwatch-ql"
  | "langy"
  | "mcp-authorize"
  | "ops-clickhouse-explain"
  | "organization-management"
  | "otlp-ingest"
  | "playground"
  | "prompts"
  | "query"
  | "root-discovery"
  | "rum"
  | "scenario-generate"
  | "scenario-run-export"
  | "scim"
  | "sse-subscriptions"
  | "trace-export"
  | "trace-legacy"
  | "traces"
  | "unsubscribe"
  | "workflow-run"
  | "workflow-studio";

/**
 * Every REST family this process builds for itself, in mount order. ORDERING is
 * load-bearing and is the order of this array.
 */
export function createApiProcessRestFeatures(options: {
  security: AppRestSecurity;
  services?: ApiProcessRestServices;
  ports: ApiProcessRestPorts;
  /** Names the packaged families this process left out, once, at boot. */
  packagedAbsence?: ApiPackagedRestAbsenceReport | undefined;
  /** Names the process-owned families whose transport is unconverted. */
  processAbsence?: ApiProcessRestAbsenceReport | undefined;
}): MountableRestApp[] {
  const { ports } = options;
  const services = options.services ?? {};
  const features: MountableRestApp[] = [];
  const report = options.processAbsence;

  /** Pushes the family, or names it in the boot report and leaves it off. */
  const mount = (
    family: ApiProcessRestFamilyName,
    build: (() => MountableRestApp | MountableRestApp[]) | null,
  ): void => {
    if (!build) {
      report?.unconverted(family);
      return;
    }
    const built = build();
    features.push(...(Array.isArray(built) ? built : [built]));
  };

  // The discovery doors and the browser's own telemetry intake. Each is built
  // by a transport still written against the deleted REST builders, so none is
  // mounted and each is named once at boot.
  mount("gateway-openapi", null);
  mount("api-discovery", null);
  mount("root-discovery", null);
  mount("rum", null);

  // The subsystem probes. `/api/health` is claimed by the process's lifecycle
  // surface at exactly that path and by nothing deeper, so the five
  // sub-paths neither shadow it nor are shadowed by it.
  const healthProbes = ports.healthProbes;
  if (healthProbes) {
    features.push(mountHealthProbeRest({ ports: healthProbes }));
  }

  // The deployment's own report on itself, beside the five probes: the same
  // subsystems asked at once, for an operator rather than for a load balancer.
  if (services.platformHealth) features.push(services.platformHealth);

  mount("analytics", null);
  mount("langwatch-ql", null);
  mount("query", null);
  mount("prompts", null);
  mount("organization-management", null);
  mount("trace-export", null);
  mount("scenario-run-export", null);
  mount("workflow-studio", null);
  mount("scenario-generate", null);
  mount("playground", null);
  mount("experiment-workbench", null);
  mount("experiment-init", null);
  mount("workflow-run", null);

  const annotations = services.annotations;
  if (annotations) {
    features.push(mountAnnotationRest({ annotations, credential: ports.handlerManagedCredential }));
  }

  // `/api/stored-objects/2026-08-22/*`: the upload confirmation, the read and
  // the delete, over the same project key every other declared family opens.
  const storedObjects = services.storedObjects;
  if (storedObjects) {
    features.push(
      mountStoredObjectRest({ storedObjects, credential: ports.handlerManagedCredential }),
    );
  }

  mount("admin", null);
  mount("bug-reports", null);
  mount("unsubscribe", null);
  // The internal cron family. Its gate is a builder-level shared-secret
  // middleware rather than a declared route access, so it converts with the
  // `internalSecret` door rather than with the probes; until then a
  // destructive door stays shut.
  mount("cron", null);
  mount("github", null);
  mount("langy", null);
  mount("auth-cli-device-flow", null);
  mount("governance-cli", null);
  mount("auth", null);
  mount("governance-ingest", null);
  mount("scim", null);
  mount("traces", null);
  mount("trace-legacy", null);
  mount("evaluations-legacy", null);

  // The packaged families, each conditional on the service this process composed for it
  // and on its own transport having been converted.
  const packaged = services.packaged;
  if (packaged) {
    features.push(
      ...mountApiPackagedRestFamilies({
        security: options.security,
        collaborators: packaged,
        ...(options.packagedAbsence ? { report: options.packagedAbsence } : {}),
      }),
    );
  }

  mount("ops-clickhouse-explain", null);
  mount("dspy-steps", null);
  mount("mcp-authorize", null);
  mount("image-proxy", null);
  mount("collector", null);
  // The OTLP receiver and the two aliases that forward into it. They travel
  // together: an alias mounted without the receiver would answer a path that
  // leads nowhere, which is one silent, unretryable data loss per batch.
  mount("otlp-ingest", null);

  return features;
}

/** Writes each unconverted family to the process log, once, by name. */
export class LoggedApiProcessRestAbsence extends ApiProcessRestAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiProcessRestAbsence {
    return new LoggedApiProcessRestAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  unconverted(family: ApiProcessRestFamilyName): void {
    this.logger.warn(
      { family },
      `API process serves no ${family} REST family: its transport is still written against ` +
        "the deleted REST builders, so the family is not mounted at all.",
    );
  }
}
