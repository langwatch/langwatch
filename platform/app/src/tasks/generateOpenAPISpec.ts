import { SCIM_SPEC_OPTIONS } from "@langwatch/enterprise-scim-server";
import { app as scimApp } from "~/server/enterprise/scim/routes";
import { generateApiSpecs } from "@langwatch/api/rest";
import {
  createAgentCacheRestApp,
  createAgentLegacyRestApp,
  createApiKeysRestApp,
  createCodingAgentRestApp,
  createDashboardsRestApp,
  createDatasetRestApp,
  createEvaluatorsRestApp,
  createEventsRestApp,
  createExperimentsRestApp,
  createGatewayPlatformRestApp,
  createGovernanceRestApp,
  createGraphsRestApp,
  createGroupRestApp,
  createMonitorRestApp,
  createModelDefaultsRestApp,
  createOrganizationsRestApp,
  createModelProvidersRestApp,
  createProjectRestApp,
  createRoleBindingsRestApp,
  createRolesRestApp,
  createScenarioEventsRestApp,
  createScenariosRestApp,
  createScimTokensRestApp,
  createSecretLegacyRestApp,
  createSimulationRunsRestApp,
  createSuiteRestApp,
  createTeamsRestApp,
  createTriggerRestApp,
  createWebhookRestApp,
  createWorkflowsRestApp,
  ORGANIZATIONS_SPEC_OPTIONS,
} from "@langwatch/platform-api";
import { createGatewaySpendRestApp } from "@langwatch/gateway-server";
import { createMeRestApp } from "@langwatch/user-server";
import {
  portsUnavailableOffRequestPath,
  servicesUnavailableOffRequestPath,
} from "@langwatch/platform-api/app-rest";
import { requireEnterprisePlanRest } from "../app/api/middleware/enterprise-gate";
import { appRestRbacVocabulary } from "../server/api/management/rbac-vocabulary";
import { appRestSecurity } from "../server/api/security";
import deepmerge from "deepmerge";
import fs from "fs";
import { generateSpecs as generateSpecsUnpinned } from "hono-openapi";
import path from "path";
import type { AnalyticsApp } from "@langwatch/analytics-server";
import { buildAnalyticsRestApp } from "../server/analytics/analytics-rest";
import { app as analyticsSqlApp } from "../app/api/analytics-sql/[[...route]]/app";
import rawCurrentSpec from "../app/api/openapiLangWatch.json";
import { organizationRestApp as organizationApp } from "../server/api/management/organization-rest";
import { requireDefaultedResponseFields } from "../server/api/openapi-response-required";
import { monitorMappingsSchema as realMonitorMappingsSchema } from "../server/tracer/tracesMapping";
import {
  allRegisteredRoutes,
  type CredentialClass,
  documentedPathOf,
  isHttpMethod,
  securityForCredentialClass,
} from "@langwatch/platform-api/app-rest";
// The two legacy route files below are wired in for the routes they describe
// and nothing else: `generateSpecs` skips any handler without `describeRoute`,
// so the unannotated siblings sharing these files (the stripe webhook, the demo
// bot, the MCP authorize step) cannot reach a public document merely by living
// next to something that is published.
import { app as evaluationsLegacyApp } from "../server/routes/evaluations-legacy";
import { app as experimentsV3App } from "../server/routes/experiments-v3";
import { app as miscApp } from "../server/routes/misc";

/**
 * `generateSpecs`, with response schemas read as output rather than input.
 *
 * The single correction the upgrade needs, applied in one place instead of at
 * 44 call sites. See `openapi-response-required.ts` for why.
 *
 * Operation ids are deliberately NOT corrected. hono-openapi v1 derives them
 * differently — `getApiCoding-agentPull-request-usage` becomes
 * `getApiCodingAgentPullRequestUsage` for the 49 paths carrying a hyphen or an
 * underscore — and the new ones are simply better. They are also not a break:
 * `openapi-python-client` snake-cases the id, so both spellings produce the
 * same `get_api_coding_agent_pull_request_usage`, and the TypeScript client is
 * keyed on `paths`, not `operations`. An id that genuinely must not move is
 * declared on its own route, the way 53 operations already declare theirs.
 */
const generateSpecs: typeof generateSpecsUnpinned = async (hono, options, c) =>
  requireDefaultedResponseFields(await generateSpecsUnpinned(hono, options, c));

/**
 * The services built on `@langwatch/api` (the management families) use the
 * package's own generator. hono-openapi stores metadata under a package-local
 * symbol, so a separately peer-resolved copy cannot see those routes. They
 * also set `excludeStaticFile: false`: every RPC name is dotted and
 * parameterless, so the default filter would drop the family silently.
 * Pinned by rpc-openapi.unit.test.ts in @langwatch/api.
 */
const FRAMEWORK_SPEC_OPTIONS = { excludeStaticFile: false } as const;
const generateFrameworkSpecs: typeof generateApiSpecs = async (hono, options, context) =>
  requireDefaultedResponseFields(await generateApiSpecs(hono, options, context));

// Surfaces whose routes come straight from their Hono apps. Their paths
// REPLACE on merge, and any path the apps no longer serve is pruned from
// the previous spec below: without the prune, a deleted route would ride
// the merge union forever.
const APP_DERIVED_PREFIXES = [
  "/api/agent-cache",
  "/api/agents",
  "/api/api-keys",
  "/api/analytics",
  "/api/coding-agent",
  "/api/v1/projects",
  "/api/dashboards",
  "/api/evaluators",
  "/api/events",
  // Singular and plural are two surfaces, not one: `/api/experiment/init` lives
  // in `misc.ts`, the rest under `/api/experiments`. Both used to be
  // hand-maintained entries in the JSON; they are generated now, so the
  // hand-written copies are pruned here.
  "/api/experiment",
  "/api/experiments",
  "/api/guardrails",
  "/api/evaluations",
  "/api/dspy",
  "/api/optimization",
  "/api/track_event",
  "/api/trigger",
  "/api/webhooks",
  "/api/gateway/v1",
  "/api/governance",
  "/api/graphs",
  "/api/groups",
  "/api/me",
  "/api/organization",
  "/api/organizations",
  "/api/projects",
  "/api/prompts",
  "/api/role-bindings",
  "/api/roles",
  "/api/scim-tokens",
  // Two surfaces again, and the segment boundary keeps them apart: the SCIM
  // 2.0 endpoints an identity provider calls live under `/api/scim/v2`, while
  // `/api/scim-tokens` is how a LangWatch admin mints the credential for them.
  "/api/scim/v2",
  "/api/dataset",
  "/api/model-defaults",
  "/api/model-providers",
  "/api/monitors",
  "/api/scenario-events",
  "/api/scenarios",
  // Secret's legacy REST surface and modern aliases are generated from their
  // current mounts, so stale checked-in variants cannot survive.
  "/api/secret",
  "/api/secrets",
  "/api/v1/secret",
  "/api/v1/secrets",
  "/api/simulation-runs",
  "/api/suites",
  "/api/teams",
  "/api/traces",
  "/api/triggers",
  "/api/workflows",
] as const;

/**
 * Whether a path is owned by one of the apps above — the prefix itself, or
 * anything below it.
 *
 * The boundary is a whole path segment, which rules out both directions of
 * accident: a bare `startsWith` would let `/api/experiment` claim a future
 * `/api/experimental-runs`, and a substring test would match the prefix
 * anywhere in the key, including keys that are not paths at all. `customMerge`
 * runs at every level of the merge, so it is asked about `paths`, `components`
 * and every operation field too.
 */
const isAppDerivedPath = (key: string): boolean =>
  APP_DERIVED_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));

const currentSpec = {
  ...rawCurrentSpec,
  paths: Object.fromEntries(
    Object.entries((rawCurrentSpec as { paths?: Record<string, unknown> }).paths ?? {}).filter(
      ([route]) => !isAppDerivedPath(route),
    ),
  ),
};

import type { PromptRestService } from "@langwatch/prompt-server";
import { buildPromptsRestApp } from "../server/api/prompts-rest";
import { secretPublicRestApp } from "../runtime/app/features/secret";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";

/**
 * Spec generation walks each route's `describeRoute` metadata and never invokes
 * a handler, so the families taking their services as per-request providers are
 * built with providers that refuse.
 */
const specOnlyServices = servicesUnavailableOffRequestPath("while generating the OpenAPI document");

/** The same refusal for the non-service capabilities, for the same reason. */
const specOnlyPorts = portsUnavailableOffRequestPath("while generating the OpenAPI document");

/**
 * The one exception to "everything off the request path refuses": the monitor
 * `mappings` body is a SHAPE the document publishes, so the placeholder the
 * refusing ports carry would silently loosen the published schema. The real
 * vocabulary comes from the trace vertical that owns it.
 */
const monitorMappingsSchema = realMonitorMappingsSchema;

/**
 * The identity and access families' remaining capabilities, refusing for the
 * same reason: spec generation walks route metadata and never invokes a
 * handler, so reaching one of these is a bug in this task rather than a
 * missing wire.
 */
const specOnly = <T>(what: string): (() => T) => {
  return () => {
    throw new Error(`${what} is not available while generating the OpenAPI document`);
  };
};
const specOnlyIdentity = {
  permissions: specOnly<any>("Authorization"),
  grants: specOnly<any>("Grants"),
  roles: specOnly<any>("Roles"),
  scim: specOnly<any>("SCIM"),
  organizationProvisioning: specOnly<any>("Organization provisioning"),
  organizationsWithTeamLookup: specOnly<any>("Organizations"),
  managementAudit: () => {
    throw new Error("Management audit is not available while generating the OpenAPI document");
  },
  ledgerActor: () => {
    throw new Error("Ledger attribution is not available while generating the OpenAPI document");
  },
};

const overwriteMerge = (_destinationArray: any[], sourceArray: any[]) => sourceArray;

const langwatchSpec = {
  openapi: "3.1.0",
  info: {
    title: "LangWatch API",
    version: "1.0.0",
    description: "LangWatch openapi spec",
  },
};

/**
 * This task generates the OpenAPI spec for the dataset API.
 *
 * It will always update the current spec with new endpoints,
 * so deleting endpoints needs to be done manually from the the
 * original file.
 */
export default async function execute() {
  console.log("Generating OpenAPI spec...");
  console.log("Building agent cache spec...");
  const agentCacheSpec = await generateSpecs(
    createAgentCacheRestApp({
      security: appRestSecurity,
      agentCache: specOnlyServices.agentCache,
    }).hono,
  );
  console.log("Building agents spec...");
  const agentsSpec = await generateSpecs(
    createAgentLegacyRestApp({
      security: appRestSecurity,
      agents: specOnlyServices.agents,
      agentPlatformUrl: specOnlyPorts.agentPlatformUrl,
    }).hono,
  );
  console.log("Building api keys spec...");
  const apiKeysSpec = await generateSpecs(
    createApiKeysRestApp({
      security: appRestSecurity,
      apiKeys: specOnlyServices.apiKeys,
      permissions: specOnlyIdentity.permissions,
      audit: specOnlyIdentity.managementAudit,
    }).hono,
  );
  console.log("Building analytics spec...");
  const analyticsSpec = await generateSpecs(
    buildAnalyticsRestApp(specOnly<AnalyticsApp>("Analytics")),
  );
  console.log("Building governed analytics SQL spec...");
  const analyticsSqlSpec = await generateSpecs(analyticsSqlApp);
  console.log("Building coding agent spec...");
  const codingAgentSpec = await generateSpecs(
    createCodingAgentRestApp({
      security: appRestSecurity,
      app: specOnlyServices.codingAgents,
      audit: specOnlyServices.codingAgentAudit,
    }).hono,
  );
  console.log("Building dashboards spec...");
  const dashboardsSpec = await generateSpecs(
    createDashboardsRestApp({
      security: appRestSecurity,
      dashboard: specOnlyServices.dashboard,
      platformUrl: specOnlyPorts.platformUrl,
    }).hono,
  );
  console.log("Building dataset spec...");
  const datasetSpec = await generateSpecs(
    createDatasetRestApp({
      security: appRestSecurity,
      app: specOnlyServices.datasets,
      platformUrl: specOnlyPorts.platformUrl,
      authorizeDirectUpload: specOnlyPorts.authorizeDatasetDirectUpload,
    }).hono,
  );
  console.log("Building evaluators spec...");
  const evaluatorsSpec = await generateSpecs(
    createEvaluatorsRestApp({
      security: appRestSecurity,
      app: specOnlyServices.evaluators,
      platformUrl: specOnlyPorts.platformUrl,
      organizationMiddleware: specOnlyPorts.organizationMiddleware,
    }).hono,
  );
  console.log("Building events spec...");
  const eventsSpec = await generateSpecs(
    createEventsRestApp({
      security: appRestSecurity,
      ports: specOnlyPorts.trackedEvents,
    }).hono,
  );
  console.log("Building experiments spec...");
  const experimentsSpec = await generateSpecs(
    createExperimentsRestApp({
      security: appRestSecurity,
      app: specOnlyServices.experiments,
    }).hono,
  );
  console.log("Building legacy evaluations spec...");
  const evaluationsLegacySpec = await generateSpecs(evaluationsLegacyApp);
  console.log("Building experiment runs spec...");
  const experimentsV3Spec = await generateSpecs(experimentsV3App);
  console.log("Building experiment init spec...");
  const miscSpec = await generateSpecs(miscApp);
  console.log("Building gateway-platform spec...");
  const gatewayPlatformSpec = await generateSpecs(
    createGatewayPlatformRestApp({
      security: appRestSecurity,
      gateway: specOnlyServices.gatewayPlatform,
    }).hono,
  );
  console.log("Building governance spec...");
  const governanceSpec = await generateSpecs(
    createGovernanceRestApp({
      security: appRestSecurity,
      app: specOnlyServices.governance,
    }).hono,
  );
  console.log("Building graphs spec...");
  const graphsSpec = await generateSpecs(
    createGraphsRestApp({
      security: appRestSecurity,
      dashboard: specOnlyServices.dashboard,
    }).hono,
  );
  console.log("Building me spec...");
  const meSpec = await generateSpecs(
    createMeRestApp({
      security: appRestSecurity,
      personalUsage: specOnlyServices.governance,
      organizations: specOnlyIdentity.organizationsWithTeamLookup,
      projects: specOnlyServices.projects,
    }).hono,
  );
  console.log("Building llm configs spec...");
  const llmConfigsSpec = await generateSpecs(
    buildPromptsRestApp(specOnly<PromptRestService>("Prompts")),
  );
  console.log("Building scenario events spec...");
  const scenarioEventsSpec = await generateSpecs(
    createScenarioEventsRestApp({
      security: appRestSecurity,
      simulations: specOnlyServices.simulations,
      scenarioTabs: specOnlyServices.scenarioTabs,
      broadcast: specOnlyServices.broadcast,
      extractInlineMedia: specOnlyPorts.extractInlineMedia,
      traceUsageGuard: specOnlyPorts.traceUsageGuard,
      bodyLimit: specOnlyPorts.bodyLimit,
      platformUrl: specOnlyPorts.platformUrl,
    }).hono,
  );
  console.log("Building monitors spec...");
  const monitorsSpec = await generateSpecs(
    createMonitorRestApp({
      security: appRestSecurity,
      app: specOnlyServices.monitors,
      platformUrl: specOnlyPorts.platformUrl,
      mappingsSchema: monitorMappingsSchema,
    }).hono,
  );
  console.log("Building model defaults spec...");
  const modelDefaultsSpec = await generateSpecs(
    createModelDefaultsRestApp({
      security: appRestSecurity,
      modelProviders: specOnlyServices.modelProviders,
    }).hono,
  );
  console.log("Building model providers spec...");
  const modelProvidersSpec = await generateSpecs(
    createModelProvidersRestApp({
      security: appRestSecurity,
      modelProviders: specOnlyServices.modelProviders,
      organizations: specOnlyServices.organizations,
    }).hono,
  );
  console.log("Building organization spec...");
  const organizationSpec = await generateFrameworkSpecs(organizationApp, FRAMEWORK_SPEC_OPTIONS);
  console.log("Building organizations (instance provisioning) spec...");
  const organizationsSpec = await generateSpecs(
    createOrganizationsRestApp({
      security: appRestSecurity,
      organizations: specOnlyIdentity.organizationProvisioning,
      apiKeys: specOnlyServices.apiKeys,
      instanceAdminKey: () => void 0,
      isSaas: () => false,
      audit: specOnlyIdentity.managementAudit,
      reportError: () => void 0,
    }).hono,
    ORGANIZATIONS_SPEC_OPTIONS,
  );
  console.log("Building projects spec...");
  const projectsSpec = await generateSpecs(
    createProjectRestApp({
      security: appRestSecurity,
      projects: specOnlyServices.projects,
      apiKeys: specOnlyServices.apiKeys,
    }).hono,
  );
  console.log("Building roles spec...");
  const rolesSpec = await generateFrameworkSpecs(
    createRolesRestApp({
      security: appRestSecurity,
      enterpriseGate: requireEnterprisePlanRest("RBAC"),
      roles: specOnlyIdentity.roles,
      vocabulary: appRestRbacVocabulary,
      ledgerActor: specOnlyIdentity.ledgerActor,
    }),
    FRAMEWORK_SPEC_OPTIONS,
  );
  console.log("Building role bindings spec...");
  const roleBindingsSpec = await generateFrameworkSpecs(
    createRoleBindingsRestApp({
      security: appRestSecurity,
      enterpriseGate: requireEnterprisePlanRest("MANAGEMENT_API"),
      permissions: specOnlyIdentity.permissions,
      grants: specOnlyIdentity.grants,
      ledgerActor: specOnlyIdentity.ledgerActor,
    }),
    FRAMEWORK_SPEC_OPTIONS,
  );
  console.log("Building scim tokens spec...");
  const scimTokensSpec = await generateFrameworkSpecs(
    createScimTokensRestApp({
      security: appRestSecurity,
      enterpriseGate: requireEnterprisePlanRest("SCIM"),
      app: specOnlyIdentity.scim,
      audit: specOnlyIdentity.managementAudit,
    }),
    FRAMEWORK_SPEC_OPTIONS,
  );
  console.log("Building scim spec...");
  // A family that authenticates with its own credential declares the scheme
  // next to the operations that name it, and `documentation` is how a
  // generated spec contributes a `components` entry the merge carries into
  // the document.
  const scimSpec = await generateSpecs(scimApp, SCIM_SPEC_OPTIONS);
  console.log("Building secrets spec...");
  const legacySecretsSpec = await generateSpecs(
    createSecretLegacyRestApp({
      security: appRestSecurity,
      secrets: specOnlyServices.secrets,
    }).hono,
  );
  const secretsSpec = await generateFrameworkSpecs(secretPublicRestApp, FRAMEWORK_SPEC_OPTIONS);
  console.log("Building scenarios spec...");
  const scenariosSpec = await generateSpecs(
    createScenariosRestApp({
      security: appRestSecurity,
      scenarios: specOnlyServices.scenarios,
      platformUrl: specOnlyPorts.platformUrl,
    }).hono,
  );
  console.log("Building simulation runs spec...");
  const simulationRunsSpec = await generateSpecs(
    createSimulationRunsRestApp({
      security: appRestSecurity,
      simulations: specOnlyServices.simulations,
      scenarioRunPlatformUrl: specOnlyPorts.scenarioRunPlatformUrl,
    }).hono,
  );
  console.log("Building suites spec...");
  const suitesSpec = await generateSpecs(
    createSuiteRestApp({
      security: appRestSecurity,
      suites: specOnlyServices.suites,
      platformUrl: specOnlyPorts.platformUrl,
    }).hono,
  );
  console.log("Building teams spec...");
  const teamsSpec = await generateSpecs(
    createTeamsRestApp({
      security: appRestSecurity,
      organizations: specOnlyServices.organizations,
      permissions: specOnlyIdentity.permissions,
      projects: specOnlyServices.projects,
      ledgerActor: specOnlyIdentity.ledgerActor,
    }).hono,
  );
  console.log("Building groups spec...");
  const groupsSpec = await generateSpecs(
    createGroupRestApp({
      security: appRestSecurity,
      organizations: specOnlyServices.organizations,
      enterpriseGate: specOnlyPorts.enterpriseGate("GROUPS"),
      ledgerActor: specOnlyPorts.organizationLedgerActor,
    }).hono,
  );
  console.log("Building traces spec...");
  const tracesSpec = await generateSpecs(tracesApp);
  console.log("Building triggers spec...");
  const triggersSpec = await generateSpecs(
    createTriggerRestApp({
      security: appRestSecurity,
      automation: specOnlyServices.automation,
      platformUrl: specOnlyPorts.platformUrl,
    }).hono,
  );
  console.log("Building workflows spec...");
  const workflowsSpec = await generateSpecs(
    createWorkflowsRestApp({
      security: appRestSecurity,
      workflows: specOnlyServices.workflows,
      ports: {
        platformUrl: specOnlyPorts.platformUrl,
        requireApiKeyPermission: specOnlyPorts.requireApiKeyPermission,
        triggerEvaluation: specOnlyPorts.triggerWorkflowEvaluation,
      },
    }).hono,
  );
  const webhooksSpec = await generateSpecs(
    createWebhookRestApp({
      security: appRestSecurity,
      webhooks: specOnlyServices.webhooks,
      canonicalError: specOnlyPorts.canonicalError,
    }).hono,
  );
  const gatewaySpendSpec = await generateSpecs(
    createGatewaySpendRestApp({
      security: appRestSecurity,
      billingPlanGate: specOnlyPorts.gatewaySpendBillingGate,
      canonicalError: specOnlyPorts.canonicalError,
      spend: specOnlyServices.gatewaySpend,
    }).hono,
  );
  console.log("Merging specs...");
  const mergedSpec = deepmerge.all(
    // Merges this way ==>
    [
      currentSpec,
      agentCacheSpec,
      agentsSpec,
      apiKeysSpec,
      analyticsSpec,
      analyticsSqlSpec,
      codingAgentSpec,
      dashboardsSpec,
      datasetSpec,
      evaluatorsSpec,
      eventsSpec,
      experimentsSpec,
      evaluationsLegacySpec,
      experimentsV3Spec,
      miscSpec,
      gatewayPlatformSpec,
      governanceSpec,
      graphsSpec,
      meSpec,
      llmConfigsSpec,
      modelDefaultsSpec,
      modelProvidersSpec,
      monitorsSpec,
      organizationSpec,
      organizationsSpec,
      roleBindingsSpec,
      rolesSpec,
      scimTokensSpec,
      scimSpec,
      scenarioEventsSpec,
      scenariosSpec,
      projectsSpec,
      legacySecretsSpec,
      secretsSpec,
      simulationRunsSpec,
      suitesSpec,
      teamsSpec,
      groupsSpec,
      tracesSpec,
      triggersSpec,
      webhooksSpec,
      gatewaySpendSpec,
      workflowsSpec,
      langwatchSpec,
    ],
    {
      arrayMerge: overwriteMerge,
      customMerge(key) {
        // Since we get these routes from the app directly,
        // we don't want to merge, we just want to replace.
        if (isAppDerivedPath(key)) {
          // Replace with new
          return (_target, source) => {
            return source;
          };
        }
      },
    },
  );

  console.log("Stamping per-operation security...");
  stampSecurityFromRegistry(mergedSpec as SpecShape);

  fs.writeFileSync(
    path.join(__dirname, "../app/api/openapiLangWatch.json"),
    JSON.stringify(withoutEmbeddedJsonSchemaDefinitions(withoutEmptyPaths(mergedSpec)), null, 2),
  );
}

type SpecShape = {
  paths?: Record<string, Record<string, unknown>>;
};

/**
 * Give every documented operation the security requirement its route actually
 * enforces.
 *
 * The document declares one top-level default, and a default is a claim about
 * every operation that does not override it. That claim was `project_api_key`
 * for the whole API, including the organization-scoped spend and webhook
 * routes a project key can never reach: an integrator following the document
 * got a 401 the document said was impossible.
 *
 * Read from the route registry rather than written per route, so an operation
 * cannot publish a credential class nothing enforces, and a route added
 * tomorrow is stamped without anyone remembering to.
 */
export function stampSecurityFromRegistry(spec: SpecShape): void {
  const registry = indexRegistryByOperation();

  for (const { routePath, operationKey, operation } of documentedOperations(spec)) {
    const credentialClass =
      registry.byOperation.get(operationKey) ?? registry.byAnyMethodPath.get(routePath);
    if (!credentialClass) {
      assertMayInheritTheDefault(operationKey, routePath);
      continue;
    }
    operation.security = securityForCredentialClass({
      operationKey,
      credentialClass,
    });
  }
}

/**
 * Refuse to leave an app-derived operation on the document default.
 *
 * Paths under an app prefix are generated from the same Hono apps the registry
 * walks, so every one of them has a route and a credential class. No match
 * means the two spellings disagree, and the operation then publishes whatever
 * the document happens to default to. That was survivable while every affected
 * route sat on a project app and the default was already right; the first one
 * on an org app would publish `project_api_key` for a route only an admin key
 * can reach, which is the precise bug this stamping exists to prevent.
 *
 * Hand-maintained entries in the JSON have no route by design and are left
 * alone.
 */
function assertMayInheritTheDefault(operationKey: string, routePath: string): void {
  if (!isAppDerivedPath(routePath)) return;
  throw new Error(
    `${operationKey} is generated from a Hono app but matches no registered route, ` +
      `so it would inherit the document-wide security default. The documented path and ` +
      `the route path have to agree — check how the route spells its parameters.`,
  );
}

/** Every operation object in the document, with the key the registry uses. */
function* documentedOperations(spec: SpecShape): Generator<{
  routePath: string;
  operationKey: string;
  operation: { security?: unknown };
}> {
  for (const [routePath, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of operationsOf(item)) {
      yield {
        routePath,
        operationKey: `${method.toUpperCase()} ${routePath}`,
        operation,
      };
    }
  }
}

/**
 * The operation members of one Path Item.
 *
 * Filtered by method name rather than by value shape: a Path Item also holds
 * `servers` and `parameters`, both arrays, and an array is an object to
 * `typeof`. Stamping `security` onto `servers` produces a document that no
 * longer validates.
 */
function operationsOf(item: Record<string, unknown>): Array<[string, { security?: unknown }]> {
  return Object.entries(item).filter(
    (entry): entry is [string, { security?: unknown }] =>
      isHttpMethod(entry[0]) && !!entry[1] && typeof entry[1] === "object",
  );
}

/**
 * The route registry keyed the way a document path is spelled.
 *
 * Any-method routes are kept in their own index rather than expanded into
 * verbs, so a specific registration on the same path still wins, and so a
 * documented verb of an `.all(...)` route is stamped rather than left
 * inheriting the document default, which is the one outcome the stamping
 * exists to prevent.
 */
function indexRegistryByOperation(): {
  byOperation: Map<string, CredentialClass>;
  byAnyMethodPath: Map<string, CredentialClass>;
} {
  const byOperation = new Map<string, CredentialClass>();
  const byAnyMethodPath = new Map<string, CredentialClass>();
  for (const route of allRegisteredRoutes()) {
    const documented = documentedPathOf(route.path);
    if (route.method === "ALL") {
      byAnyMethodPath.set(documented, route.credentialClass);
      continue;
    }
    byOperation.set(`${route.method} ${documented}`, route.credentialClass);
  }
  return { byOperation, byAnyMethodPath };
}

const OPENAPI_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

/**
 * Drops path entries left holding no operation.
 *
 * `describeRoute({ hide: true })` removes the operation but keeps its path key,
 * so a hidden route leaves `"/api/experiments/execute": {}` behind — an entry
 * that documents nothing and reads, to anything scanning the document, as a
 * path we publish.
 */
function withoutEmptyPaths<T extends { paths?: Record<string, unknown> }>(spec: T): T {
  const paths = spec.paths;
  if (!paths) return spec;

  return {
    ...spec,
    paths: Object.fromEntries(
      Object.entries(paths).filter(([, item]) =>
        OPENAPI_METHODS.some((method) => (item as Record<string, unknown>)?.[method] !== undefined),
      ),
    ),
  };
}

/**
 * Zod 4 emits local JSON Schema `$defs` alongside the component references it
 * has already resolved. OpenAPI 3.0 does not define `$defs`; leaving it in a
 * schema makes client generators treat it as a required data property. The
 * local definitions are redundant here—all emitted references already point
 * at `#/components/schemas/*`—so remove them from the published document.
 */
function withoutEmbeddedJsonSchemaDefinitions<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withoutEmbeddedJsonSchemaDefinitions) as T;
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$defs")
      .map(([key, item]) => [key, withoutEmbeddedJsonSchemaDefinitions(item)]),
  ) as T;
}
