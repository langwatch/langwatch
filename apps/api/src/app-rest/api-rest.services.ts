/**
 * What this process composed for the families it owns: one provider per family,
 * so naming a family in the door registry never forces its service to be built.
 * The doors themselves are `api-rest.doors.ts`; nothing here mounts anything.
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type {
  AppRestManagementAuditPort,
  PlatformUrlBuilder,
  RestErrorHandler,
} from "@langwatch/api/rest";

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
import type { ImageProxyRestPorts } from "../features/image-proxy/image-proxy-rest.mount.ts";
import type { HealthProbeRestPorts } from "../features/health/health-probe-rest.mount.ts";
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
import type { McpAuthorizeRestPorts } from "../features/mcp/mcp-authorize-rest.mount.ts";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { PlatformHealthApi } from "@langwatch/platform-health-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { ApiHandlerManagedCredentialPort } from "./api-rest.runtime.ts";

/**
 * The product services this process may or may not have composed. Each is a
 * provider for the same reason the packaged list's are: mounting a family must
 * not force its service to be constructed.
 */
export type ApiRestServices = Readonly<{
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
   * The deployment's own liveness report, or none. The monitoring key the
   * family reads it under is the module's own declared fact, not a port.
   */
  platformHealth?: (() => PlatformHealthApi) | undefined;
  /**
   * The public stored-object family's application, or none. The SAME one
   * `/api/files` reads bytes through, so an object confirmed on one door is
   * the object the other serves.
   */
  storedObjects?: (() => StoredObjectApi) | undefined;
  /** The rows `/api/dataset` reads and writes, or none. */
  datasets?: (() => DatasetApi) | undefined;
  /**
   * The stored credentials `/api/secret` and `/api/secrets` answer over, or
   * none: a door over a store this process cannot decrypt is worse than no door.
   */
  secrets?: (() => SecretApi) | undefined;
  /**
   * The application behind `/api/v1/run-plans`, `/api/v1/test-suites` and the
   * deprecated `/api/suites` alias, or none. All three read it, so the fallback
   * order and the resolved organization never disagree between doors.
   */
  suites?: (() => SuiteApi) | undefined;
}>;

export type ApiRestPorts = Readonly<{
  /**
   * Resolves a project API key and enforces one permission as a key ceiling,
   * answering the legacy refusal bodies the handler-managed families publish.
   */
  handlerManagedCredential: ApiHandlerManagedCredentialPort;
  /**
   * The process's own error envelope, which a family that names none of its
   * own answers every refusal in.
   */
  errors: RestErrorHandler;
  /** The external UI address a read or write links back to. */
  platformUrl: PlatformUrlBuilder;
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
  imageProxy?: ImageProxyRestPorts | undefined;
}>;
