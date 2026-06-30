import fs from "fs";
import { generateSpecs } from "hono-openapi";
import path from "path";

import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as eventsApp } from "../app/api/events/[[...route]]/app";
import { app as gatewayPlatformApp } from "../app/api/gateway-platform/[[...route]]/app";
import { app as governanceApp } from "../app/api/governance/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as modelDefaultsApp } from "../app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import currentSpec from "../app/api/openapiLangWatch.json";
import { app as llmConfigsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as workflowsApp } from "../app/api/workflows/[[...route]]/app";
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
  console.log("Building gateway-platform spec...");
  const gatewayPlatformSpec = await generateSpecs(gatewayPlatformApp);
  console.log("Building governance spec...");
  const governanceSpec = await generateSpecs(governanceApp);
  console.log("Building graphs spec...");
  const graphsSpec = await generateSpecs(graphsApp);
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
  console.log("Building traces spec...");
  const tracesSpec = await generateSpecs(tracesApp);
  console.log("Building triggers spec...");
  const triggersSpec = await generateSpecs(triggersApp);
  console.log("Building workflows spec...");
  const workflowsSpec = await generateSpecs(workflowsApp);
  console.log("Merging specs...");
  // Order carried over from the legacy deepmerge.all call: specs are deep-merged
  // in array order (a later spec deep-merges onto earlier ones; arrays are
  // replaced). Apps own disjoint /api/<namespace>s, so their paths never collide
  // here — order only affects shared top-level keys such as components.schemas.
  const appSpecs = [
    agentsSpec,
    analyticsSpec,
    dashboardsSpec,
    datasetSpec,
    evaluatorsSpec,
    eventsSpec,
    gatewayPlatformSpec,
    governanceSpec,
    graphsSpec,
    llmConfigsSpec,
    modelDefaultsSpec,
    modelProvidersSpec,
    monitorsSpec,
    scenarioEventsSpec,
    scenariosSpec,
    secretsSpec,
    simulationRunsSpec,
    suitesSpec,
    tracesSpec,
    triggersSpec,
    workflowsSpec,
  ];
  const mergedSpec = mergeOpenAPISpecs({
    currentSpec,
    appSpecs,
    baseSpec: langwatchSpec,
  });

  fs.writeFileSync(
    path.join(__dirname, "../app/api/openapiLangWatch.json"),
    JSON.stringify(mergedSpec, null, 2),
  );
}
