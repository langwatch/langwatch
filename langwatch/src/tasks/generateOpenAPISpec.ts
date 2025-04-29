import { generateSpecs } from "hono-openapi";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as llmConfigsApp } from "../app/api/prompts/app";
import deepmerge from "deepmerge";
import currentSpec from "../app/api/openapiLangWatch.json";
import fs from "fs";
import path from "path";

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
  console.log("Merging specs...");
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
