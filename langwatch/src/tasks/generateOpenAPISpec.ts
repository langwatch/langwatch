import fs from "fs";
import path from "path";

import deepmerge from "deepmerge";
import { generateSpecs } from "hono-openapi";

import currentSpec from "../app/api/openapiLangWatch.json";
import datasetApp from "../app/api/datasets/[[...route]]/app";
import { app as llmConfigsApp } from "../app/api/prompts/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as evaluationsApp } from "../app/api/evaluations/[[...route]]/app";
import experimentsApp from "../app/api/experiments/[[...route]]/app";

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
  console.log("Building dataset spec...");
  const datasetSpec = await generateSpecs(datasetApp);
  console.log("Building llm configs spec...");
  const llmConfigsSpec = await generateSpecs(llmConfigsApp);
  console.log("Building scenario events spec...");
  const scenarioEventsSpec = await generateSpecs(scenarioEventsApp);
  console.log("Building evaluations spec...");
  const evaluationsSpec = await generateSpecs(evaluationsApp);
  console.log("Building experiments spec...");
  const experimentsSpec = await generateSpecs(experimentsApp);
  console.log("Merging specs...");
  const mergedSpec = deepmerge.all(
    // Merges this way ==>
    [
      currentSpec,
      datasetSpec,
      llmConfigsSpec,
      scenarioEventsSpec,
      evaluationsSpec,
      experimentsSpec,
      langwatchSpec,
    ],
    {
      arrayMerge: overwriteMerge,
      customMerge(key) {
        // Since we get these routes from the app directly,
        // we don't want to merge, we just want to replace.
        if (
          key.includes("/api/prompts") ||
          key.includes("/api/dataset") ||
          key.includes("/api/scenario-events") ||
          key.includes("/api/evaluations") ||
          key.includes("/api/experiment")
        ) {
          // Replace with new
          return (_target, source) => {
            return source;
          };
        }
      },
    }
  );

  fs.writeFileSync(
    path.join(__dirname, "../app/api/openapiLangWatch.json"),
    JSON.stringify(mergedSpec, null, 2)
  );
}
