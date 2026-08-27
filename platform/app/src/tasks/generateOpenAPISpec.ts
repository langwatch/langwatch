import { SCIM_SPEC_OPTIONS } from "@langwatch/enterprise-scim-server";
import { app as scimApp } from "~/server/enterprise/scim/routes";
import { generateApiSpecs } from "@langwatch/api";
import deepmerge from "deepmerge";
import fs from "fs";
import { generateSpecs as generateSpecsUnpinned } from "hono-openapi";
import path from "path";
import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as analyticsSqlApp } from "../app/api/analytics-sql/[[...route]]/app";
import { app as apiKeysApp } from "../app/api/api-keys/[[...route]]/app";
import { app as codingAgentApp } from "../app/api/coding-agent/[[...route]]/app";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as eventsApp } from "../app/api/events/[[...route]]/app";
import { app as experimentsApp } from "../app/api/experiments/[[...route]]/app";
import { app as gatewayPlatformApp } from "../app/api/gateway-platform/[[...route]]/app";
import { app as gatewaySpendApp } from "../app/api/gateway-spend/[[...route]]/app";
import { app as governanceApp } from "../app/api/governance/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as groupsApp } from "../app/api/groups/[[...route]]/app";
import { app as meApp } from "../app/api/me/[[...route]]/app";
import { app as modelDefaultsApp } from "../app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import rawCurrentSpec from "../app/api/openapiLangWatch.json";
import { app as organizationApp } from "../app/api/organization/[[...route]]/app";
import { app as organizationsApp } from "../app/api/organizations/[[...route]]/app";
import { ORGANIZATIONS_SPEC_OPTIONS } from "../app/api/organizations/[[...route]]/openapi";
import { app as projectsApp } from "../app/api/projects/[[...route]]/app";
import { app as roleBindingsApp } from "../app/api/role-bindings/[[...route]]/app";
import { app as rolesApp } from "../app/api/roles/[[...route]]/app";
import { app as scimTokensApp } from "../app/api/scim-tokens/[[...route]]/app";
import { requireDefaultedResponseFields } from "../server/api/openapi-response-required";
import {
  allRegisteredRoutes,
  type CredentialClass,
  documentedPathOf,
  isHttpMethod,
  securityForCredentialClass,
} from "../server/api/security";
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
  "/api/secrets",
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
    Object.entries(
      (rawCurrentSpec as { paths?: Record<string, unknown> }).paths ?? {},
    ).filter(([route]) => !isAppDerivedPath(route)),
  ),
};

import { app as llmConfigsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as teamsApp } from "../app/api/teams/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as webhooksApp } from "../app/api/webhooks/[[...route]]/app";
import { app as workflowsApp } from "../app/api/workflows/[[...route]]/app";

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
  console.log("Building agents spec...");
  const agentsSpec = await generateSpecs(agentsApp);
  console.log("Building api keys spec...");
  const apiKeysSpec = await generateSpecs(apiKeysApp);
  console.log("Building analytics spec...");
  const analyticsSpec = await generateSpecs(analyticsApp);
  console.log("Building governed analytics SQL spec...");
  const analyticsSqlSpec = await generateSpecs(analyticsSqlApp);
  console.log("Building coding agent spec...");
  const codingAgentSpec = await generateSpecs(codingAgentApp);
  console.log("Building dashboards spec...");
  const dashboardsSpec = await generateSpecs(dashboardsApp);
  console.log("Building dataset spec...");
  const datasetSpec = await generateSpecs(datasetApp);
  console.log("Building evaluators spec...");
  const evaluatorsSpec = await generateSpecs(evaluatorsApp);
  console.log("Building events spec...");
  const eventsSpec = await generateSpecs(eventsApp);
  console.log("Building experiments spec...");
  const experimentsSpec = await generateSpecs(experimentsApp);
  console.log("Building legacy evaluations spec...");
  const evaluationsLegacySpec = await generateSpecs(evaluationsLegacyApp);
  console.log("Building experiment runs spec...");
  const experimentsV3Spec = await generateSpecs(experimentsV3App);
  console.log("Building experiment init spec...");
  const miscSpec = await generateSpecs(miscApp);
  console.log("Building gateway-platform spec...");
  const gatewayPlatformSpec = await generateSpecs(gatewayPlatformApp);
  console.log("Building governance spec...");
  const governanceSpec = await generateSpecs(governanceApp);
  console.log("Building graphs spec...");
  const graphsSpec = await generateSpecs(graphsApp);
  console.log("Building me spec...");
  const meSpec = await generateSpecs(meApp);
  console.log("Building llm configs spec...");
  const llmConfigsSpec = await generateSpecs(llmConfigsApp);
  console.log("Building scenario events spec...");
  const scenarioEventsSpec = await generateSpecs(scenarioEventsApp);
  console.log("Building monitors spec...");
  const monitorsSpec = await generateSpecs(monitorsApp);
  console.log("Building model defaults spec...");
  const modelDefaultsSpec = await generateSpecs(modelDefaultsApp);
  console.log("Building model providers spec...");
  const modelProvidersSpec = await generateSpecs(modelProvidersApp);
  console.log("Building organization spec...");
  const organizationSpec = await generateFrameworkSpecs(
    organizationApp,
    FRAMEWORK_SPEC_OPTIONS,
  );
  console.log("Building organizations (instance provisioning) spec...");
  const organizationsSpec = await generateSpecs(
    organizationsApp,
    ORGANIZATIONS_SPEC_OPTIONS,
  );
  console.log("Building projects spec...");
  const projectsSpec = await generateSpecs(projectsApp);
  console.log("Building roles spec...");
  const rolesSpec = await generateFrameworkSpecs(rolesApp, FRAMEWORK_SPEC_OPTIONS);
  console.log("Building role bindings spec...");
  const roleBindingsSpec = await generateFrameworkSpecs(
    roleBindingsApp,
    FRAMEWORK_SPEC_OPTIONS,
  );
  console.log("Building scim tokens spec...");
  const scimTokensSpec = await generateFrameworkSpecs(
    scimTokensApp,
    FRAMEWORK_SPEC_OPTIONS,
  );
  console.log("Building scim spec...");
  // A family that authenticates with its own credential declares the scheme
  // next to the operations that name it, and `documentation` is how a
  // generated spec contributes a `components` entry the merge carries into
  // the document.
  const scimSpec = await generateSpecs(scimApp, SCIM_SPEC_OPTIONS);
  console.log("Building secrets spec...");
  const secretsSpec = await generateFrameworkSpecs(secretsApp, FRAMEWORK_SPEC_OPTIONS);
  console.log("Building scenarios spec...");
  const scenariosSpec = await generateSpecs(scenariosApp);
  console.log("Building simulation runs spec...");
  const simulationRunsSpec = await generateSpecs(simulationRunsApp);
  console.log("Building suites spec...");
  const suitesSpec = await generateSpecs(suitesApp);
  console.log("Building teams spec...");
  const teamsSpec = await generateSpecs(teamsApp);
  console.log("Building groups spec...");
  const groupsSpec = await generateSpecs(groupsApp);
  console.log("Building traces spec...");
  const tracesSpec = await generateSpecs(tracesApp);
  console.log("Building triggers spec...");
  const triggersSpec = await generateSpecs(triggersApp);
  console.log("Building workflows spec...");
  const workflowsSpec = await generateSpecs(workflowsApp);
  const webhooksSpec = await generateSpecs(webhooksApp);
  const gatewaySpendSpec = await generateSpecs(gatewaySpendApp);
  console.log("Merging specs...");
  const mergedSpec = deepmerge.all(
    // Merges this way ==>
    [
      currentSpec,
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
    JSON.stringify(
      withoutEmbeddedJsonSchemaDefinitions(withoutEmptyPaths(mergedSpec)),
      null,
      2,
    ),
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
function operationsOf(
  item: Record<string, unknown>,
): Array<[string, { security?: unknown }]> {
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
        OPENAPI_METHODS.some(
          (method) => (item as Record<string, unknown>)?.[method] !== undefined,
        ),
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
