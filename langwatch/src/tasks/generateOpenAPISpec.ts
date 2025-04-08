import { generateSpecs } from "hono-openapi";

import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";

/**
 * This task generates the OpenAPI spec for the dataset API.
 * It is very bare bones right now just so we copy and paste into langwatch-docs, in
 * the future it will evolve to generate the whole spec file directly for all endpoints
 */
export default async function execute() {
  const openAPISpec = await generateSpecs(datasetApp);
  console.log(JSON.stringify(openAPISpec, null, 2), {});
}
