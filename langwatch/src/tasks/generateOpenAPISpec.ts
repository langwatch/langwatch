import { generateSpecs } from "hono-openapi";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as llmConfigsApp } from "../app/api/llmConfigs/[[...route]]/app";
import deepmerge from "deepmerge";

/**
 * This task generates the OpenAPI spec for the dataset API.
 * It is very bare bones right now just so we copy and paste into langwatch-docs, in
 * the future it will evolve to generate the whole spec file directly for all endpoints
 */
export default async function execute() {
  const datasetSpec = await generateSpecs(datasetApp);
  const llmConfigsSpec = await generateSpecs(llmConfigsApp);
  const mergedSpec = deepmerge(datasetSpec, llmConfigsSpec);

  console.log(JSON.stringify(mergedSpec, null, 2));
}
