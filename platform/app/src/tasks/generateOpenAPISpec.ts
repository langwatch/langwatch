import fs from "fs";
import { generateSpecs } from "hono-openapi";
import path from "path";

import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as apiKeysApp } from "../app/api/api-keys/[[...route]]/app";
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
import currentSpec from "../app/api/openapiLangWatch.json";
import { app as projectsApp } from "../app/api/projects/[[...route]]/app";
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
// The two legacy route files below are wired in for the routes they describe
// and nothing else: `generateSpecs` skips any handler without `describeRoute`,
// so the unannotated siblings sharing these files (the stripe webhook, the demo
// bot, the MCP authorize step) cannot reach a public document merely by living
// next to something that is published.
import { app as evaluationsLegacyApp } from "../server/routes/evaluations-legacy";
import { app as experimentsV3App } from "../server/routes/experiments-v3";
import { app as miscApp } from "../server/routes/misc";
import { mergeOpenAPISpecs } from "./mergeOpenAPISpecs";

const langwatchSpec = {
  openapi: "3.1.0",
  info: {
    title: "LangWatch API",
    version: "1.0.0",
    description: "LangWatch openapi spec",
  },
};

/**
 * This task generates the OpenAPI spec for the LangWatch API.
 *
 * Each Hono app owns its `/api/<namespace>` entirely, so paths in those
 * namespaces are refreshed from the apps every run: routes an app no longer
 * generates (removed routes, renamed path params) are pruned automatically
 * instead of lingering. Paths in namespaces that no app generates are
 * hand-maintained in the committed spec and preserved untouched. See
 * `mergeOpenAPISpecs` for the merge contract.
 */
export default async function execute() {
  console.log("Generating OpenAPI spec...");
  console.log("Building agents spec...");
  const agentsSpec = await generateSpecs(agentsApp);
  console.log("Building api keys spec...");
  const apiKeysSpec = await generateSpecs(apiKeysApp);
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
  console.log("Building projects spec...");
  const projectsSpec = await generateSpecs(projectsApp);
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
  // Order carried over from the legacy deepmerge.all call: specs are deep-merged
  // in array order (a later spec deep-merges onto earlier ones; arrays are
  // replaced). Apps own disjoint /api/<namespace>s, so their paths never collide
  // here — order only affects shared top-level keys such as components.schemas.
  const appSpecs = [
    agentsSpec,
    apiKeysSpec,
    analyticsSpec,
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
  ];
  const mergedSpec = mergeOpenAPISpecs({
    currentSpec,
    appSpecs,
    baseSpec: langwatchSpec,
  });

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
