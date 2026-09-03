/**
 * The REST families the API process mounts from its OWN graph.
 *
 * This is the ONE list. It was two for a while, because the packaged families
 * lived behind an all-or-nothing call that meant holding thirty-two services at
 * once; that call is deleted and the packaged families are now
 * {@link mountApiPackagedRestFamilies}, a per-family conditional enumeration
 * this one spreads in. So the list covers the families that describe the
 * process (the API document), the ones the process owns outright, and every
 * product family whose service this process has composed.
 *
 * The invariant is the reason this is a list at all. A family reaches the route-policy registry when it is BUILT, and
 * the registry is what the route-authorization audit reads — so a family that
 * is served must appear in an enumeration, and mounting is iterating one.
 * Adding an `api.route(...)` beside these instead of an entry here is the thing
 * to refuse.
 *
 * A service this process did not compose leaves its family OUT rather than
 * mounting it over a throwing stub: a route that exists and answers 500 is
 * worse than one that is honestly not there, and the composition says which
 * ones and why at boot.
 */
import type { AnnotationApp } from "@langwatch/annotation-server";
import { createAnnotationsRestApp } from "@langwatch/annotation-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type {
  AppRestManagementAuditPort,
  AppRestSecurity,
  MountableRestApp,
} from "@langwatch/api/rest";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createBugReportsRestApp, type BugReportRestPorts } from "@langwatch/ops-server";
import { createUnsubscribeRestApp, type UnsubscribeRestPorts } from "@langwatch/automation-server";
import {
  createLangyInternalRestApp,
  createLangyRelayRestApp,
  createLangyTurnsRestApp,
  createLangyUiActionsRestApp,
} from "@langwatch/langy-server";
import { createGithubRestApp, type GithubRestPorts } from "@langwatch/github-server";
import {
  createAuthCliDeviceFlowRestApp,
  type AuthCliDeviceFlowRestPorts,
} from "@langwatch/auth-server";
import {
  createGovernanceCliRestApp,
  createGovernanceIngestRestApp,
  type GovernanceCliRestPorts,
  type GovernanceIngestRestPorts,
} from "@langwatch/enterprise-governance-server";
import { createScimProtocolRestApp, createScimWebhookRestApp } from "@langwatch/enterprise-api";

import type { ApiScimRestPorts } from "../app/api-scim.composition";

import type { ApiLangyRestComposition } from "../features/langy/langy-rest.mount";

import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PromptRestService } from "@langwatch/prompt-server";

import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type {
  OrganizationRestInviteService,
  OrganizationRestService,
} from "@langwatch/organization-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";

import type { DashboardApp } from "@langwatch/dashboard-server";

import type { AppRestBroadcast } from "@langwatch/api/rest";
import type { SimulationService } from "@langwatch/scenario-contract";

import type { ApiHandlerManagedSessionPort } from "../app/api-handler-managed-session";
import {
  mountScenarioRunExportRest,
  type ScenarioRunExportAudit,
} from "../features/export/scenario-run-export-rest.mount";
import { mountAnalyticsRest } from "../features/analytics/analytics-rest.mount";
import {
  type ApiLangWatchQLRestCollaborators,
  mountLangWatchQLRest,
} from "../features/analytics/langwatch-ql-rest.mount";
import { mountQueryRest } from "../features/analytics/query-rest.mount";
import { mountOrganizationRest } from "../features/organization/organization-rest.mount";
import { mountPromptsRest } from "../features/prompt/prompt-rest.mount";
import type { ApiAuthoringRestComposition } from "../app/api-authoring-rest.composition";
import { mountDatasetGenerateRest } from "../features/dataset/dataset-generate-rest.mount";
import { mountPlaygroundRest } from "../features/model-provider/playground-rest.mount";
import { mountScenarioGenerateRest } from "../features/scenario/scenario-generate-rest.mount";
import { mountWorkflowStudioRest } from "../features/workflow/workflow-studio-rest.mount";
import {
  mountExperimentV3Rest,
  type ApiExperimentV3RestCollaborators,
} from "../features/experiment/experiment-v3-rest.mount";
import {
  mountExperimentInitRest,
  type ApiExperimentInitRestCollaborators,
} from "../features/experiment/experiment-init-rest.mount";
import {
  mountWorkflowRunRest,
  type ApiWorkflowRunRestCollaborators,
} from "../features/workflow/workflow-run-rest.mount";
import { createApiDiscoveryRestApp } from "../features/discovery/api-discovery-rest";
import { createGatewayOpenApiRestApp } from "../features/discovery/gateway-openapi-rest";
import { createRootDiscoveryRestApp } from "../features/discovery/root-discovery-rest";
import {
  createHealthProbeRestApp,
  type HealthProbeRestPorts,
} from "../features/health/health-probe-rest";
import type { RumRateLimiter } from "../features/rum/rum-ingest.service";
import { createRumRestApp } from "../features/rum/rum-rest";
import {
  createOtlpIngestRestApp,
  createOtlpPathAliasRestApp,
  type CollectorRestPorts,
  type OtlpIngestRestPorts,
} from "@langwatch/trace-server";
import {
  mountEvaluationsLegacyRest,
  type ApiEvaluationBatchRestCollaborators,
  type ApiEvaluationRunRestCollaborators,
} from "../features/evaluation/evaluations-legacy-rest.mount";
import {
  mountCollectorRest,
  mountTraceLegacyRest,
  mountTracesRest,
  type ApiTraceLegacyRestCollaborators,
  type ApiTracesRestCollaborators,
} from "../features/trace/trace-rest.mount";
import {
  createOpsClickHouseExplainRestApp,
  type OpsClickHouseExplainRestPorts,
} from "@langwatch/ops-server";
import { createDspyStepsRestApp, type DspyStepsRestPorts } from "@langwatch/experiment-server";
import {
  createMcpAuthorizeRestApp,
  type McpAuthorizeRestPorts,
} from "@langwatch/hosted-mcp-server";
import { createImageProxyRestApp } from "../features/image-proxy/image-proxy-rest";
import {
  mountApiPackagedRestFamilies,
  type ApiPackagedRestAbsenceReport,
  type ApiPackagedRestCollaborators,
} from "./app-rest.packaged-families";

/**
 * The project credential a handler-managed family resolves through.
 *
 * The API process's one implementation is `ApiHandlerManagedCredentials`; the
 * shape is restated here rather than imported from one family's package so a
 * second family taking the same port does not have to depend on the first.
 */
export type ApiHandlerManagedCredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<
  | Readonly<{ ok: true; project: Readonly<{ id: string }>; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>
>;

/**
 * The product services this process may or may not have composed. Each is a
 * provider for the same reason the packaged list's are: mounting a family must
 * not force its service to be constructed.
 */
export type ApiProcessRestServices = Readonly<{
  /** The reviewer's comments `/api/annotations` reads and writes. */
  annotations?: (() => AnnotationApp) | undefined;
  /** The charted reads `/api/analytics/timeseries` answers from. */
  analytics?: (() => AnalyticsApp) | undefined;
  /**
   * The governed-SQL family's collaborators plus the dashboard the saved
   * charts live on, or none.
   *
   * One entry rather than five because they are one family: the nine
   * endpoints share a base path, a rollout switch and a project guard, and a
   * process that could run a statement but not save the chart it draws would
   * publish half a surface.
   */
  langWatchQL?:
    | Readonly<{
        collaborators: ApiLangWatchQLRestCollaborators;
        dashboard: () => DashboardApp;
      }>
    | undefined;
  /** The prompt library `/api/prompts` reads and writes. */
  prompts?: (() => PromptRestService) | undefined;
  /**
   * The organization directory a project-scoped family resolves a tenant
   * through. Held apart from any one service because the resolution is the
   * PROCESS's: every family that needs an organization on the request context
   * takes the same one, so two doors cannot disagree about which tenant a
   * project belongs to.
   */
  organizations?: (() => Pick<OrganizationService, "getTeamById">) | undefined;
  /**
   * The organization management family's collaborators, or none.
   *
   * All five travel together because the family is one credential class: an
   * organization key reads the settings, the membership and the access
   * breakdown, and the settings write revokes trace shares across every
   * project in the tenant. A process holding the directory but not the share
   * ledger could turn sharing off and leave the links live.
   */
  /**
   * The scenario run export's collaborators, or none.
   *
   * All four travel together, and the SESSION is the one that decides: a bulk
   * export is attributable to a person by design, and a process with no
   * browser-session transport cannot name one. Such a process leaves the
   * family off rather than mounting a door that refuses every caller.
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
        shares: () => ShareService;
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
   *
   * None where this process composed no trace read stack: `/api/traces/search`
   * and `/api/traces/:traceId` ARE that stack, and a family mounted over a
   * refusing one would answer 500 to every reader rather than 404 to a door
   * that is honestly not here.
   */
  traceReads?: ApiTracesRestCollaborators | undefined;
  /**
   * The deprecated `/api/trace/*` and `/api/thread/:id` family's
   * collaborators, or none.
   *
   * All four travel together because two of the five routes MINT and REVOKE
   * public links: a process holding the reads but not the share ledger could
   * serve a trace it cannot unshare.
   */
  traceLegacy?: ApiTraceLegacyRestCollaborators | undefined;
  /**
   * The four AUTHORING doors a person reaches while editing something — the
   * Studio's code completion and its run dispatch, the playground, the dataset
   * row generator and the scenario author-assist — or none.
   *
   * One entry rather than four because a browser session is what every one of
   * them resolves a person with, and a process holding no session transport
   * can mount none of them. Which of the four are actually present beyond that
   * is the composition's own answer — see `composeApiAuthoringRest`.
   */
  authoring?: ApiAuthoringRestComposition | undefined;
  /**
   * The experiment workbench's ten doors, or none.
   *
   * One entry because the family is one app plus the alias that forwards into
   * it. Whether its four RUN doors answer is the run loop's own affair: they
   * refuse `service_unavailable` by name on a process with no progress store,
   * while the four setup doors keep answering — which is why an absent run
   * loop does not take the family off.
   */
  experimentWorkbench?: ApiExperimentV3RestCollaborators | undefined;
  /**
   * The SDK's experiment create-or-take door, or none.
   *
   * Held apart from the workbench's ten even though both live under
   * `/api/experiment*`: this one is an SDK's project key and the workbench's
   * are a browser session and a richer credential. What it shares with the
   * batch result log below is the find-or-create SERVICE, and that is the
   * point — one construction, so one slug names one experiment on both doors.
   */
  experimentInit?: ApiExperimentInitRestCollaborators | undefined;
  /**
   * `POST /api/evaluations/batch/log_results`'s collaborators, or none.
   *
   * None where this process registered no experiment run writer: the rows are
   * a run's history, and a door that accepted them with nowhere to write is
   * one an SDK believes reported its results.
   */
  evaluationBatch?: ApiEvaluationBatchRestCollaborators | undefined;
  /**
   * The four evaluate doors' collaborators, or none.
   *
   * None where this process composed no evaluator RUNTIME. The doors are then
   * left unregistered rather than mounted: each one authenticates, validates
   * and then has to run an evaluator, and a 500 at that last step is what an
   * SDK retries forever.
   */
  evaluationRun?: ApiEvaluationRunRestCollaborators | undefined;
  /**
   * The three URLs a synchronous studio run is started from, or none.
   *
   * Held apart from the Studio's editor doors even though two of the paths sit
   * under `/api/workflows`: those two are a browser's session doors and these
   * are an SDK's key doors, and a process can hold the graph service without
   * holding a session transport.
   */
  workflowRun?: ApiWorkflowRunRestCollaborators | undefined;
  /**
   * The families that live in a FEATURE PACKAGE, and the services this process
   * composed for them.
   *
   * One entry rather than twenty-eight because the decision is per family
   * INSIDE it: `mountApiPackagedRestFamilies` mounts each one whose service is
   * present and names the rest at boot. It is still one enumeration iterated
   * once — see that module for why that is load-bearing rather than tidy.
   */
  packaged?: ApiPackagedRestCollaborators | undefined;
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
   *
   * None when this process composed no command queue: a receiver that accepts
   * a span and has nowhere to send it answers 200 to data it then drops, which
   * is the one failure an exporter can neither detect nor retry. Its own
   * per-signal ports say which of traces, logs and metrics are served — a
   * signal whose collection is absent is not mounted at all.
   */
  otlpIngest?: OtlpIngestRestPorts | undefined;
  /**
   * The SDK collector's collaborators, or none.
   *
   * None for the same reason the OTLP receiver's are: `POST /api/collector` is
   * the other wire into the same ingestion path, and a door that accepts a
   * trace it cannot enqueue tells an SDK the trace landed. Composed from the
   * SAME ingestion service the receiver uses — one dedup gate, not two.
   */
  collector?: CollectorRestPorts | undefined;
  /**
   * The public issue-report intake's collaborators, or none.
   *
   * None when this process composed no database: a report that cannot be
   * written is one a struggling customer believes they filed, which is worse
   * than a door that is honestly not there.
   */
  bugReports?: BugReportRestPorts | undefined;
  /**
   * The one-click unsubscribe door's collaborators, or none.
   *
   * None where this process composed no automation application. Left off
   * rather than mounted refusing: the URL is printed inside mail already
   * delivered, and a recipient who clicks it must either be unsubscribed or
   * reach a door that plainly is not here — never one that says it failed.
   */
  unsubscribe?: UnsubscribeRestPorts | undefined;
  /**
   * The four Langy doors' collaborators, or none.
   *
   * One entry rather than four because they are one graph: the public turn
   * surface and the UI-action surface share a credential chain whose refusal
   * ORDER is the contract, and the two internal doors share a bearer. A
   * process holding half of it would serve a turn the agent could not report
   * the result of. Which of the four are actually present is the composition's
   * own answer — see `composeApiLangyRest`.
   */
  langy?: ApiLangyRestComposition | undefined;
  /**
   * The GitHub App installation flow's collaborators, or none.
   *
   * None without a session port: `/install` and `/setup` are both bound to the
   * browser session that started the flow, and the webhook alone is not a
   * family — GitHub only delivers to it for an installation `/setup` recorded.
   */
  github?: GithubRestPorts | undefined;
  /**
   * The RFC 8628 CLI device grant's collaborators, or none.
   *
   * None without Redis, a database or a browser session: a device code needs
   * somewhere ephemeral to live, the membership re-derivation that stands
   * between an offboarded person and a live credential needs rows, and the
   * three approval routes cannot name who is approving without a session.
   */
  authCliDeviceFlow?: AuthCliDeviceFlowRestPorts | undefined;
  /**
   * The CLI governance plane's collaborators, or none.
   *
   * None where this process composed no Enterprise governance application:
   * these routes ARE that application's CLI surface, and thirteen doors over a
   * capability that is not there would answer 500 to every pre-flight.
   */
  governanceCli?: GovernanceCliRestPorts | undefined;
  /**
   * The Activity Monitor's receivers' collaborators, or none.
   *
   * None without both the governance application (which resolves a source's
   * bearer secret) and a trace collection (which is where the spans go). Its
   * own per-signal ports say which receivers are served — the log and metric
   * routes are not registered at all where this process folds neither.
   */
  governanceIngest?: GovernanceIngestRestPorts | undefined;
  /**
   * The SCIM 2.0 provisioning surface's collaborators, or none.
   *
   * None where this process composed no Enterprise SCIM application. The
   * fifteen protocol routes and the Auth0 intake are one entry because they
   * provision through one service: a process holding one and not the other
   * would let a directory create a member on one door the other cannot see.
   * Left off rather than mounted refusing — an identity provider's nightly
   * run retries a 500 forever, and reads a 404 as "not configured here".
   */
  scim?: ApiScimRestPorts | undefined;
  /**
   * The deployment's public origin, where it declared one.
   *
   * Deep links on a REST response are built from it. Optional because a
   * response whose payload is already correct must not fail for want of an
   * absolute convenience link; an unset origin yields a path-only link, which
   * is what the builder this replaces did.
   */
  publicBaseUrl?: string | undefined;
  /**
   * The five subsystem health probes' collaborators, or none.
   *
   * None where this deployment declared no public origin: every probe sends a
   * canary back through the boundary it is testing, so one with no origin to
   * dial could only ever report on nothing. The probes are the one family here
   * whose absence a MONITOR notices, which is why it is a 404 rather than five
   * endpoints answering 500 to an alerting rule.
   */
  healthProbes?: HealthProbeRestPorts | undefined;
  /**
   * The operator-only ClickHouse EXPLAIN endpoint's collaborators, or none.
   *
   * None where the deployment provisioned no dedicated readonly ClickHouse
   * account or no operator secret. The endpoint is cross-tenant BY DESIGN, so
   * it is the one family whose absence is the safe answer rather than a
   * degradation: with nothing to compare a bearer against, and no account the
   * query may run as, a mounted door would leave a regex filter as the only
   * thing between a token and the whole fleet's data.
   */
  opsClickHouseExplain?: OpsClickHouseExplainRestPorts | undefined;
  /**
   * The DSPy optimizer's step log's collaborators, or none.
   *
   * None where this process composed no per-project model-cost catalogue: a
   * step recorded with every `cost` null is one an optimizer dashboard renders
   * as a free run, which is a wrong fact rather than a missing one.
   */
  dspySteps?: DspyStepsRestPorts | undefined;
  /**
   * The hosted MCP OAuth approval step's collaborators, or none.
   *
   * None without Redis, a cipher and a browser session: the code lives in
   * Redis for ten minutes, it embeds the project's credential under this
   * deployment's key, and it is minted for the person who approved it.
   */
  mcpAuthorize?: McpAuthorizeRestPorts | undefined;
  /**
   * The public image relay's egress policy, or none.
   *
   * Always present in practice — the policy is two configuration leaves — but
   * optional so a composition that reads no egress configuration mounts no
   * public fetching door rather than one with an unstated fence.
   */
  imageProxy?:
    | Readonly<{ blockLocalHttpCalls: boolean; allowedHosts: readonly string[] }>
    | undefined;
}>;

/**
 * Every REST family this process builds for itself, in mount order.
 *
 * ORDERING is load-bearing and is the order of this array:
 *
 *  1. `gateway-openapi` before anything else under `/api/gateway/v1`. The
 *     unauthenticated spec document shares that namespace with the
 *     credentialed gateway resource routes, so it must not be shadowed by a
 *     sibling that grows a parameterised segment at the root of it.
 *  2. `api-discovery` and `root-discovery`, which own literal paths in
 *     namespaces nothing else claims and are order-free between themselves.
 *  3. `rum`, which owns `/api/rum` outright.
 *  4. The product families. `/api/analytics`, `/api/prompts`,
 *     `/api/organization`, `/api/export/scenario-runs`, `/api/annotations` and
 *     `/api/bug-reports` each own a literal first segment, so they neither
 *     shadow nor are shadowed by anything above them, and are order-free
 *     between themselves. The governed-SQL family is the one that does NOT:
 *     it lives under `/api/v1/projects`, inside a namespace the OTLP alias
 *     below claims with a wildcard, so it has to be registered BEFORE that
 *     alias — which the array order gives it.
 *  5. The OTLP receiver, then — LAST of all — its path-alias re-dispatcher.
 *     The alias forwards INTO the receiver, so it must be registered after it;
 *     and its wildcards (`/api/otel/*`, `/api/collector/*`, `/api/v1/*`,
 *     `/v1/*`) are broad on purpose, so it must also come after anything else
 *     claiming those namespaces. It declines every path its allow-list does not
 *     recognise, so a family mounted after it keeps its own routing and its own
 *     404 — which is what `/api/v1/secret` depends on.
 *
 *  Between 4 and 5 sit the PACKAGED families, and their position is the one
 *  thing about them that is not free. They come AFTER every literal door that
 *  shares a namespace with one of them — `/api/dataset/generate` and
 *  `/api/dataset/evaluate` before the dataset family's `/:slugOrId`, the
 *  workbench's `/api/experiments/runs` before the experiment family's
 *  `/:slug`, the Studio's `/api/workflows/code-completion` before the workflow
 *  family's `/:workflowId` — and BEFORE the OTLP alias, whose wildcards are
 *  broad on purpose.
 */
export function createApiProcessRestFeatures(options: {
  security: AppRestSecurity;
  services?: ApiProcessRestServices;
  ports: ApiProcessRestPorts;
  /** Names the packaged families this process left out, once, at boot. */
  packagedAbsence?: ApiPackagedRestAbsenceReport | undefined;
}): MountableRestApp[] {
  const { security, ports } = options;
  const services = options.services ?? {};
  const features: MountableRestApp[] = [
    createGatewayOpenApiRestApp({ security }),
    createApiDiscoveryRestApp({ security }),
    createRootDiscoveryRestApp({ security }),
    createRumRestApp({ security, rateLimit: ports.rateLimit }),
  ];

  // The subsystem probes. `/api/health` is claimed by the process's lifecycle
  // surface at exactly that path and by nothing deeper, so the five
  // sub-paths neither shadow it nor are shadowed by it.
  const healthProbes = ports.healthProbes;
  if (healthProbes) {
    features.push(createHealthProbeRestApp({ security, ports: healthProbes }));
  }

  // The charted reads' public door, over the SAME application the browser's
  // `analytics.getTimeseries` procedure resolves on, so a rule added on one
  // door cannot leave the other answering the old way.
  const analytics = services.analytics;
  if (analytics) {
    features.push(...mountAnalyticsRest({ security, analytics }));
  }

  // The governed-SQL family, over the SAME LangWatchQL service the workbench's
  // own procedures validate against.
  const langWatchQL = services.langWatchQL;
  if (langWatchQL) {
    features.push(
      mountLangWatchQLRest({
        security,
        collaborators: langWatchQL.collaborators,
        dashboard: langWatchQL.dashboard,
        publicBaseUrl: ports.publicBaseUrl,
      }),
      // The one door for raw LangWatchQL, off the same collaborators: the
      // two cannot be composed apart, because a process serving saved charts
      // against a runner this door does not reach would answer the same
      // statement two ways.
      mountQueryRest({ security, collaborators: langWatchQL.collaborators }),
    );
  }

  // The prompt library. Mounted only where BOTH the prompt service and the
  // organization directory are composed: every route on the family resolves
  // the project's organization before it reads anything, so a family holding
  // one and not the other would answer 500 on every request.
  const prompts = services.prompts;
  const organizations = services.organizations;
  if (prompts && organizations) {
    features.push(
      mountPromptsRest({
        security,
        prompts,
        organizations,
        publicBaseUrl: ports.publicBaseUrl,
      }),
    );
  }

  // The organization management family. Mounted only where every one of its
  // five collaborators is composed, for the reason its type gives.
  const organizationManagement = services.organizationManagement;
  if (organizationManagement) {
    features.push(mountOrganizationRest({ security, ...organizationManagement }));
  }

  // The bulk run export. Its own basePath is literal and claimed by nothing
  // else, so it is order-free among the product families.
  const scenarioRunExport = services.scenarioRunExport;
  if (scenarioRunExport) {
    features.push(mountScenarioRunExportRest({ security, ...scenarioRunExport }));
  }

  // The four AUTHORING doors. Each owns a literal path inside a namespace
  // nothing above claims, and each is registered ahead of any parameterised
  // sibling that could swallow it: `/api/dataset/generate` before a dataset
  // family's `/:slugOrId`, and `/api/workflows/{code-completion,post_event}`
  // before a workflow family's `/:workflowId/run`. This process composes
  // neither of those packaged families today; the order keeps the rule true
  // for when it does.
  const authoring = services.authoring;
  if (authoring?.datasetGenerate) {
    features.push(mountDatasetGenerateRest({ security, ...authoring.datasetGenerate }));
  }
  if (authoring?.workflowStudio) {
    features.push(mountWorkflowStudioRest({ security, collaborators: authoring.workflowStudio }));
  }
  if (authoring?.scenarioGenerate) {
    features.push(mountScenarioGenerateRest({ security, ...authoring.scenarioGenerate }));
  }
  if (authoring?.playground) {
    features.push(mountPlaygroundRest({ security, ...authoring.playground }));
  }

  // The experiment workbench, and — LAST among the families sharing
  // `/api/experiments` — its `/api/evaluations/v3` alias, which forwards into
  // it. The mount returns both in registration order, and the workbench must
  // come before any packaged experiment family so its literal `/runs`
  // siblings are not swallowed by that family's `:slug`.
  const experimentWorkbench = services.experimentWorkbench;
  if (experimentWorkbench) {
    features.push(...mountExperimentV3Rest({ security, collaborators: experimentWorkbench }));
  }

  // The SDK's create-or-take door. `/api/experiment/init` is a literal path in
  // the SINGULAR namespace, which nothing above claims — the workbench owns
  // `/api/experiments` — so it neither shadows nor is shadowed by them.
  const experimentInit = services.experimentInit;
  if (experimentInit) {
    features.push(mountExperimentInitRest({ security, collaborators: experimentInit }));
  }

  // The synchronous run URLs. AFTER the Studio's two literal doors above,
  // because `/api/workflows/:workflowId/run` would otherwise read
  // `code-completion` as a workflow id.
  const workflowRun = services.workflowRun;
  if (workflowRun) {
    features.push(mountWorkflowRunRest({ security, collaborators: workflowRun }));
  }

  const annotations = services.annotations;
  if (annotations) {
    features.push(
      createAnnotationsRestApp({
        security,
        annotations,
        credential: ports.handlerManagedCredential,
      }),
    );
  }

  const bugReports = ports.bugReports;
  if (bugReports) {
    features.push(createBugReportsRestApp({ security, ports: bugReports }));
  }

  const unsubscribe = ports.unsubscribe;
  if (unsubscribe) {
    features.push(createUnsubscribeRestApp({ security, ports: unsubscribe }));
  }

  // The Langy doors. `/api/langy` and `/api/internal/langy` are literal first
  // segments nothing else claims, so their order relative to the families
  // above is free; the relay is registered after the internal family it shares
  // a basePath and a bearer with, matching the order the platform router used.
  // `/api/github` and its two `github-langy` aliases: literal first segments
  // nothing above claims.
  const github = ports.github;
  if (github) {
    features.push(createGithubRestApp({ security, ports: github }));
  }

  const langy = ports.langy;
  if (langy) {
    features.push(createLangyTurnsRestApp({ security, ports: langy.turns }));
    if (langy.uiActions) {
      features.push(createLangyUiActionsRestApp({ security, ports: langy.uiActions }));
    }
    features.push(createLangyInternalRestApp({ security, ports: langy.internal }));
    if (langy.relay) {
      features.push(createLangyRelayRestApp({ security, ports: langy.relay }));
    }
  }

  // The two halves of `/api/auth/cli`, whose path sets are disjoint: the
  // device grant owns the RFC 8628 lifecycle, the governance plane owns the
  // reads and mints a device session authorizes. Both must be registered
  // BEFORE any `/api/auth/*` catch-all, which swallows every `/auth/*` sibling
  // after it — this process mounts none, and that is what keeps them reachable.
  const authCliDeviceFlow = ports.authCliDeviceFlow;
  if (authCliDeviceFlow) {
    features.push(createAuthCliDeviceFlowRestApp({ security, ports: authCliDeviceFlow }));
  }

  const governanceCli = ports.governanceCli;
  if (governanceCli) {
    features.push(createGovernanceCliRestApp({ security, ports: governanceCli }));
  }

  // `/api/ingest` is a literal first segment nothing else claims, so it is
  // order-free among the families above — and it is registered before the OTLP
  // alias below for the same reason the governed-SQL family is: that alias
  // claims broad wildcards and everything with its own routing goes first.
  const governanceIngest = ports.governanceIngest;
  if (governanceIngest) {
    features.push(createGovernanceIngestRestApp({ security, ports: governanceIngest }));
  }

  // The SCIM 2.0 provisioning family and the Auth0 intake beside it.
  // `/api/scim/v2` is a literal namespace nothing else claims, and
  // `/api/webhooks/auth0-scim` is a literal path under a namespace whose only
  // other claimant is the packaged webhook family's `/api/webhooks/v1/*` — a
  // disjoint set — so both are order-free among the families here. Three of
  // the fifteen carry no credential on purpose: an identity provider
  // negotiates capabilities before a token exists.
  const scim = ports.scim;
  if (scim) {
    features.push(createScimProtocolRestApp({ security, scim: scim.scim }));
    features.push(createScimWebhookRestApp({ security, ports: scim }));
  }

  // The v1 trace reads. `/api/traces` is a literal first segment nothing above
  // claims, and it must be registered before the OTLP path alias below, whose
  // `/api/v1/*` wildcard is broad on purpose.
  const traceReads = services.traceReads;
  if (traceReads) {
    features.push(mountTracesRest({ security, collaborators: traceReads }));
  }

  // The deprecated trace family: `/api/trace/*` and `/api/thread/:id`. Literal
  // first segments, and deliberately NOT under `/api/traces` — the two are
  // different surfaces with different refusal bodies, and the deprecated one
  // stamps `Deprecation` and a successor `Link` on every read.
  const traceLegacy = services.traceLegacy;
  if (traceLegacy) {
    features.push(mountTraceLegacyRest({ security, collaborators: traceLegacy }));
  }

  // The legacy evaluation family. Its catalogue route needs nothing, so the
  // family is mounted unconditionally; its batch and evaluate halves register
  // only where their port groups are supplied — the batch log where this
  // process registered the run writer, the four evaluate doors where it
  // composed an evaluator runtime. See the mount.
  features.push(
    mountEvaluationsLegacyRest({
      security,
      credential: ports.handlerManagedCredential,
      ...(services.evaluationBatch ? { batch: services.evaluationBatch } : {}),
      ...(services.evaluationRun ? { evaluationRun: services.evaluationRun } : {}),
    }),
  );

  // The packaged families, each conditional on the service this process
  // composed for it. HERE and not earlier: `/api/dataset/generate` above,
  // `/api/dataset/evaluate` immediately above, the workbench's literal
  // `/api/experiments/runs` and the Studio's `/api/workflows/code-completion`
  // all have to be registered before the packaged family whose parameterised
  // segment would otherwise swallow them.
  const packaged = services.packaged;
  if (packaged) {
    features.push(
      ...mountApiPackagedRestFamilies({
        security,
        collaborators: packaged,
        ...(options.packagedAbsence ? { report: options.packagedAbsence } : {}),
      }),
    );
  }

  // The operator EXPLAIN endpoint. `/api/ops` is a literal first segment
  // nothing else claims, so its position among the families is free.
  const opsClickHouseExplain = ports.opsClickHouseExplain;
  if (opsClickHouseExplain) {
    features.push(createOpsClickHouseExplainRestApp({ security, ports: opsClickHouseExplain }));
  }

  // The three doors the retired `misc.ts` still held that this process can
  // serve. Each owns a literal first segment nothing above claims —
  // `/api/dspy`, `/api/mcp`, `/api/image-proxy` — so their order is free, and
  // all three are registered before the OTLP alias below for the same reason
  // everything with its own routing is.
  const dspySteps = ports.dspySteps;
  if (dspySteps) {
    features.push(createDspyStepsRestApp({ security, ports: dspySteps }));
  }

  const mcpAuthorize = ports.mcpAuthorize;
  if (mcpAuthorize) {
    features.push(createMcpAuthorizeRestApp({ security, ports: mcpAuthorize }));
  }

  const imageProxy = ports.imageProxy;
  if (imageProxy) {
    features.push(createImageProxyRestApp({ security, ...imageProxy }));
  }

  // The SDK collector, before the OTLP alias that claims `/api/collector/*`.
  const collector = ports.collector;
  if (collector) {
    features.push(mountCollectorRest({ security, ports: collector }));
  }

  const otlpIngest = ports.otlpIngest;
  if (otlpIngest) {
    const receiver = createOtlpIngestRestApp({ security, ports: otlpIngest });
    features.push(receiver);
    // Last, and forwarding into the app immediately above it. An exporter that
    // posts to a path nobody serves gets one silent, unretryable data loss per
    // batch, so the aliases exist wherever the receiver does — never on their
    // own, which is why they take the receiver rather than importing it.
    features.push(createOtlpPathAliasRestApp({ canonical: receiver }));
  }

  return features;
}
