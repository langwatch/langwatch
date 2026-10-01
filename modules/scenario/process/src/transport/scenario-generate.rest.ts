import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import {
  ScenarioApi,
  scenarioGenerateRequestSchema,
  scenarioGenerateResponseSchema,
} from "@langwatch/scenario-contract";

/** The author-assist door delegates model work to the composed Scenario application. */
export const scenarioGenerateRest = defineRestRouter(ScenarioApi)
  .withNamespace("scenario")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("browser")
  .post("/api/scenario/generate", "generateScenario")
  .withInput(scenarioGenerateRequestSchema)
  .withBodyLimit({ maxBytes: resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE") })
  .withPermission("scenarios:manage", { at: "route", param: "projectId" })
  .withOutput(scenarioGenerateResponseSchema)
  .withDocs({ description: "Generate or refine a scenario with the author-assist model" })
  .handle(({ app, input }) => app.generateScenario(input))
  .build();
