import deepmerge from "deepmerge";
import fs from "fs";
import { generateSpecs } from "hono-openapi";
import path from "path";

import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
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
// The two legacy route files below are wired in for the routes they describe
// and nothing else: `generateSpecs` skips any handler without `describeRoute`,
// so the unannotated siblings sharing these files (the stripe webhook, the demo
// bot, the MCP authorize step) cannot reach a public document merely by living
// next to something that is published.
import { app as experimentsV3App } from "../server/routes/experiments-v3";
import { app as miscApp } from "../server/routes/misc";

// Surfaces whose routes come straight from their Hono apps. Their paths
// REPLACE on merge, and any path the apps no longer serve is pruned from
// the previous spec below: without the prune, a deleted route would ride
// the merge union forever.
const APP_DERIVED_PREFIXES = [
  "/api/agents",
  "/api/analytics",
  "/api/dashboards",
  "/api/evaluators",
  "/api/events",
  // Singular and plural are two surfaces, not one: `/api/experiment/init` lives
  // in `misc.ts`, the rest under `/api/experiments`. Both used to be
  // hand-maintained entries in the JSON; they are generated now, so the
  // hand-written copies are pruned here.
  "/api/experiment",
  "/api/experiments",
  "/api/webhooks",
  "/api/gateway/v1",
  "/api/governance",
  "/api/graphs",
  "/api/me",
  "/api/prompts",
  "/api/dataset",
  "/api/model-providers",
  "/api/monitors",
  "/api/scenario-events",
  "/api/scenarios",
  "/api/secrets",
  "/api/simulation-runs",
  "/api/suites",
  "/api/traces",
  "/api/triggers",
  "/api/workflows",
];

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
  APP_DERIVED_PREFIXES.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}/`),
  );

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

const overwriteMerge = (_destinationArray: any[], sourceArray: any[]) =>
  sourceArray;

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
  console.log("Building analytics spec...");
  const analyticsSpec = await generateSpecs(analyticsApp);
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
  console.log("Building secrets spec...");
  const secretsSpec = await generateSpecs(secretsApp);
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
      analyticsSpec,
      dashboardsSpec,
      datasetSpec,
      evaluatorsSpec,
      eventsSpec,
      experimentsSpec,
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
      scenarioEventsSpec,
      scenariosSpec,
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

  fs.writeFileSync(
    path.join(__dirname, "../app/api/openapiLangWatch.json"),
    JSON.stringify(withoutEmptyPaths(mergedSpec), null, 2),
  );
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
];

/**
 * Drops path entries left holding no operation.
 *
 * `describeRoute({ hide: true })` removes the operation but keeps its path key,
 * so a hidden route leaves `"/api/experiments/execute": {}` behind — an entry
 * that documents nothing and reads, to anything scanning the document, as a
 * path we publish.
 */
function withoutEmptyPaths<T extends { paths?: Record<string, unknown> }>(
  spec: T,
): T {
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
