import deepmerge from "deepmerge";
import fs from "fs";
import { generateSpecs } from "hono-openapi";
import path from "path";

import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import currentSpec from "../app/api/openapiLangWatch.json";
import { app as llmConfigsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";

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
  console.log("Building analytics spec...");
  const analyticsSpec = await generateSpecs(analyticsApp);
  console.log("Building dataset spec...");
  const datasetSpec = await generateSpecs(datasetApp);
  console.log("Building evaluators spec...");
  const evaluatorsSpec = await generateSpecs(evaluatorsApp);
  console.log("Building llm configs spec...");
  const llmConfigsSpec = await generateSpecs(llmConfigsApp);
  console.log("Building scenario events spec...");
  const scenarioEventsSpec = await generateSpecs(scenarioEventsApp);
  console.log("Building scenarios spec...");
  const scenariosSpec = await generateSpecs(scenariosApp);
  console.log("Building traces spec...");
  const tracesSpec = await generateSpecs(tracesApp);
  console.log("Merging specs...");
  const mergedSpec = deepmerge.all(
    // Merges this way ==>
    [
      currentSpec,
      analyticsSpec,
      datasetSpec,
      evaluatorsSpec,
      llmConfigsSpec,
      scenarioEventsSpec,
      scenariosSpec,
      tracesSpec,
      langwatchSpec,
    ],
    {
      arrayMerge: overwriteMerge,
      customMerge(key) {
        // Since we get these routes from the app directly,
        // we don't want to merge, we just want to replace.
        if (
          key.includes("/api/analytics") ||
          key.includes("/api/evaluators") ||
          key.includes("/api/prompts") ||
          key.includes("/api/dataset") ||
          key.includes("/api/scenario-events") ||
          key.includes("/api/scenarios") ||
          key.includes("/api/traces")
        ) {
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
    JSON.stringify(mergedSpec, null, 2),
  );
}
