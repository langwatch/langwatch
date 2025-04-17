import { generateSpecs } from "hono-openapi";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as llmConfigsApp } from "../app/api/llmConfigs/[[...route]]/app";
import deepmerge from "deepmerge";
import currentSpec from "../app/api/openapiLangWatch.json";
import fs from "fs";
import path from "path";

const overwriteMerge = (destinationArray, sourceArray, options) => sourceArray;

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
  const datasetSpec = await generateSpecs(datasetApp);
  const llmConfigsSpec = await generateSpecs(llmConfigsApp);
  const mergedSpec = deepmerge.all(
    // Merges this way ==>
    [currentSpec, datasetSpec, llmConfigsSpec, langwatchSpec],
    {
      arrayMerge: overwriteMerge,
    }
  );

  fs.writeFileSync(
    path.join(__dirname, "../app/api/openapiLangWatch.json"),
    JSON.stringify(mergedSpec, null, 2)
  );
}
