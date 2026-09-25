import {
  baseResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  resolver,
} from "@langwatch/api/rest";
import {
  responseSchemas,
  scenarioEventArchiveOutputSchema,
  scenarioEventArchiveQuerySchema,
  scenarioEventBrowserTabBodySchema,
  scenarioEventSchema,
  ScenarioApi,
} from "@langwatch/scenario-contract";

/** Main's ceiling for one event, sized for inline media payloads. */
const SCENARIO_EVENT_MAX_BYTES = 50 * 1024 * 1024;

/** Scenario-run event reporting, live-tab handoff, and scoped archival. */
export const scenarioEventsRest = defineRestRouter(ScenarioApi)
  .withNamespace("scenario-events")
  .withVersion(MANAGEMENT_API_VERSION)
  .post("/", "reportScenarioEvent")
  .withInput(scenarioEventSchema)
  .withPermission("scenarios:create")
  .withOutput(responseSchemas.success)
  .withStatus(201)
  .withBodyLimit({ maxBytes: SCENARIO_EVENT_MAX_BYTES })
  .withDocs({
    description: "Create a new scenario event",
    responses: {
      ...baseResponses,
      400: {
        description: "Invalid event data",
        content: { "application/json": { schema: resolver(responseSchemas.error) } },
      },
    },
  })
  .withMiddleware(projectRestFacts)
  .handle(({ app, input, scope }, project) =>
    app.reportScenarioEvent({
      event: input,
      projectId: scope.id,
      projectSlug: project.projectSlug,
    }),
  )
  .post("/browser-tab", "offerScenarioBrowserTab")
  .withInput(scenarioEventBrowserTabBodySchema)
  .withPermission("scenarios:create")
  .withOutput(responseSchemas.browserTabHandoff)
  .withDocs({
    description:
      "Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live tab took it.",
    responses: baseResponses,
  })
  .withMiddleware(projectRestFacts)
  .handle(({ app, input, scope }, project) =>
    app.offerScenarioBrowserTab({
      ...input,
      projectId: scope.id,
      projectSlug: project.projectSlug,
    }),
  )
  .delete("/", "archiveScenarioEvents")
  .withQuery(scenarioEventArchiveQuerySchema)
  .withPermission("scenarios:manage")
  .withOutput(scenarioEventArchiveOutputSchema)
  .withDocs({
    description:
      "Archive simulation runs. Pass exactly one of scenarioSetId (archives every run in the set; scenarioSetId=default targets the implicit default set) or scenarioRunId (archives that one run).",
    responses: {
      ...baseResponses,
      400: {
        description: "Missing or invalid scope parameter",
        content: { "application/json": { schema: resolver(responseSchemas.error) } },
      },
      404: {
        description: "Scenario run not found in this project",
        content: { "application/json": { schema: resolver(responseSchemas.error) } },
      },
    },
  })
  .handle(({ app, input, scope }) => app.archiveScenarioEvents({ ...input, projectId: scope.id }))
  .build();
