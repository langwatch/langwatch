/**
 * The `/api/v1/test-suites` REST family: the suites scenarios are filed into,
 * and the runs they start. Addressed only under `/api/v1`, like run plans.
 */
import { randomUUID } from "node:crypto";

import {
  badRequestSchema,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { deriveRunActor, type ScenarioTestSuite } from "@langwatch/scenario-contract";
import {
  SuiteApi,
  SuiteNotFoundError,
  testSuiteIdParamsSchema,
  testSuiteListQuerySchema,
  testSuiteArchiveResultSchema,
} from "@langwatch/suite-contract";
import { z } from "zod";

import {
  runPlanRunResultSchema,
  suiteSurfaceFact,
  testSuiteCreateInputSchema,
  testSuiteDetailWireSchema,
  testSuiteRunInputSchema,
  testSuiteUpdateInputSchema,
  testSuiteWireSchema,
  toRunItemsWire,
} from "../rules/suite-wire-v1.rules.ts";

const notFound = documentedResponses({ 404: badRequestSchema });

/** What a route knows about the project and the person behind the credential. */
type ProjectFacts = z.output<typeof projectRestFacts.schema>;

function suiteWire(params: {
  app: SuiteApi;
  projectSlug: string;
  suite: ScenarioTestSuite;
}): z.infer<typeof testSuiteWireSchema> {
  const { suite } = params;

  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    scenarioIds: suite.scenarioIds,
    scenarioCount: suite.scenarioIds.length,
    fields: suite.fields,
    evaluators: suite.evaluators,
    archivedAt: suite.archivedAt?.toISOString() ?? null,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
    platformUrl: params.app.platformUrl({
      projectSlug: params.projectSlug,
      path: `/simulations/run-plans/${suite.slug}`,
    }),
  };
}

/** The row this id names, refusing a run plan id the same way a missing one is. */
async function readTestSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<ScenarioTestSuite> {
  const found = await params.app.getByIdOrTestSuite({ id: params.id, projectId: params.projectId });
  if (found.kind !== "test_suite") throw new SuiteNotFoundError("Test suite not found");

  return found.testSuite;
}

/** Where the run plan a run was filed under opens in the platform. */
async function resolvedPlanUrl(params: {
  app: SuiteApi;
  projectId: string;
  projectSlug: string;
  planId: string;
}): Promise<string> {
  const found = await params.app.getByIdOrTestSuite({
    id: params.planId,
    projectId: params.projectId,
  });
  if (found.kind !== "suite") throw new SuiteNotFoundError("Run plan not found");

  return params.app.platformUrl({
    projectSlug: params.projectSlug,
    path: `/simulations/run-plans/${found.suite.slug}`,
  });
}

/** One test suite with the scenarios filed in it, named. */
async function readTestSuiteDetail(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
  projectSlug: string;
}): Promise<z.infer<typeof testSuiteDetailWireSchema>> {
  const suite = await readTestSuite(params);
  const scenarios = await params.app.resolveActiveScenarioNames({
    scenarioIds: suite.scenarioIds,
    projectId: params.projectId,
  });

  return {
    ...suiteWire({ app: params.app, projectSlug: params.projectSlug, suite }),
    scenarios,
  };
}

/**
 * Edits the suite this id names, refusing a run plan id as a miss. Send only
 * what changes: the slug is kept, so links and run history stay where they
 * are.
 */
async function updateTestSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof testSuiteIdParamsSchema> & z.infer<typeof testSuiteUpdateInputSchema>;
  projectId: string;
  projectSlug: string;
}): Promise<z.infer<typeof testSuiteWireSchema>> {
  await readTestSuite({
    app: params.app,
    id: params.input.id,
    projectId: params.projectId,
  });
  const suite = await params.app.updateTestSuite({
    testSuiteId: params.input.id,
    projectId: params.projectId,
    ...(params.input.name !== undefined && { name: params.input.name }),
    ...(params.input.fields !== undefined && { fields: params.input.fields }),
    ...(params.input.evaluators !== undefined && { evaluators: params.input.evaluators }),
  });

  return suiteWire({ app: params.app, projectSlug: params.projectSlug, suite });
}

/** Archives the suite this id names, and the scenarios filed in it. */
async function archiveTestSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof testSuiteArchiveResultSchema>> {
  await readTestSuite(params);
  await params.app.archiveTestSuite({ testSuiteId: params.id, projectId: params.projectId });

  return { id: params.id, archived: true };
}

/**
 * Runs every scenario filed in the suite against the targets sent with the
 * request. Filed under the run plan the scope resolves: a test suite's own
 * runs live in the same run-plan history as every other run of it.
 */
async function runTestSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof testSuiteIdParamsSchema> & z.infer<typeof testSuiteRunInputSchema>;
  projectId: string;
  project: ProjectFacts;
  surface: string | null;
}): Promise<z.infer<typeof runPlanRunResultSchema>> {
  const { app, input, projectId } = params;
  await readTestSuite({ app, id: input.id, projectId });
  const actor = deriveRunActor({
    userId: params.project.viewerUserId,
    surfaceHeader: params.surface,
  });
  const result = await app.runPlan({
    projectId,
    ...(input.name !== undefined && { name: input.name }),
    config: {
      scope: { mode: "test_suites", testSuiteIds: [input.id] },
      targets: input.targets,
      ...(input.repeatCount !== undefined && { repeatCount: input.repeatCount }),
      ...(input.simulatorModel !== undefined && { simulatorModel: input.simulatorModel }),
      ...(input.judgeModel !== undefined && { judgeModel: input.judgeModel }),
    },
    idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
    ...(input.parameters !== undefined && { parameters: input.parameters }),
    ...(input.note !== undefined && { note: input.note }),
    ...(actor !== undefined && { actor }),
  });

  return {
    scheduled: true,
    batchRunId: result.batchRunId,
    setId: result.setId,
    jobCount: result.jobCount,
    skippedArchived: result.skippedArchived,
    items: toRunItemsWire(result.items),
    runPlanId: result.suiteId,
    planName: result.planName,
    created: result.created,
    platformUrl: await resolvedPlanUrl({
      app,
      projectId,
      projectSlug: params.project.projectSlug,
      planId: result.suiteId,
    }),
  };
}

/** The `/api/v1/test-suites` collection, item and run endpoints. */
export function createTestSuitesRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<SuiteApi>;
}> {
  return defineRestRouter(SuiteApi)
    .withNamespace("test-suites")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("v1-only")

    .get("/", "listTestSuites")
    .withQuery(testSuiteListQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(z.array(testSuiteWireSchema))
    .withDocs({
      tags: ["Test Suites"],
      description:
        "List the project's test suites. Archived suites are left out unless includeArchived is set. Run plans are not test suites and are listed by the run plans family.",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      (
        await app.listTestSuites({ projectId: scope.id, includeArchived: input.includeArchived })
      ).map((suite) => suiteWire({ app, projectSlug: project.projectSlug, suite })),
    )

    .post("/", "createTestSuite")
    .withInput(testSuiteCreateInputSchema)
    .withPermission("scenarios:create")
    .withOutput(testSuiteWireSchema)
    .withStatus(201)
    .withDocs({
      tags: ["Test Suites"],
      description:
        "Create a test suite. It starts empty: scenarios join it by being filed into it, and the targets a run goes against are sent with the run. It may declare fields and attach evaluators from the start.",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      suiteWire({
        app,
        projectSlug: project.projectSlug,
        suite: await app.createTestSuite({
          projectId: scope.id,
          name: input.name,
          ...(input.fields !== undefined && { fields: input.fields }),
          ...(input.evaluators !== undefined && { evaluators: input.evaluators }),
        }),
      }),
    )

    .get("/:id", "getTestSuite")
    .withParams(testSuiteIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(testSuiteDetailWireSchema)
    .withDocs({
      tags: ["Test Suites"],
      summary: "Read one test suite",
      description:
        "Read one test suite with the scenarios filed in it, named. An id the project does not hold, and a run plan id, both answer 404 suite_not_found.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      readTestSuiteDetail({
        app,
        id: input.id,
        projectId: scope.id,
        projectSlug: project.projectSlug,
      }),
    )

    .patch("/:id", "updateTestSuite")
    .withParams(testSuiteIdParamsSchema)
    .withInput(testSuiteUpdateInputSchema)
    .withPermission("scenarios:update")
    .withOutput(testSuiteWireSchema)
    .withDocs({
      tags: ["Test Suites"],
      description:
        "Edit a test suite: its name, the fields it declares, the evaluators attached to it. Send only what changes. The slug is kept on a rename, so links and run history stay where they are.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      updateTestSuite({
        app,
        input,
        projectId: scope.id,
        projectSlug: project.projectSlug,
      }),
    )

    .delete("/:id", "archiveTestSuite")
    .withParams(testSuiteIdParamsSchema)
    .withPermission("scenarios:manage")
    .withOutput(testSuiteArchiveResultSchema)
    .withDocs({
      tags: ["Test Suites"],
      description:
        "Archive a test suite. The scenarios filed in it are archived with it, in one step, because the suite is where they live.",
      responses: notFound,
    })
    .handle(({ app, input, scope }) => archiveTestSuite({ app, id: input.id, projectId: scope.id }))

    .post("/:id/run", "runTestSuite")
    .withParams(testSuiteIdParamsSchema)
    .withInput(testSuiteRunInputSchema)
    .withPermission("scenarios:create")
    .withOutput(runPlanRunResultSchema)
    .withDocs({
      tags: ["Test Suites"],
      summary: "Run a test suite",
      description:
        "Run every scenario filed in the test suite against the targets sent with the request. The run is filed under a run plan named after the suite and its targets unless a name is sent. A request that names no target answers 422 suite_targets_required.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts, suiteSurfaceFact)
    .handle(({ app, input, scope }, project, surface) =>
      runTestSuite({ app, input, projectId: scope.id, project, surface }),
    )
    .build();
}
