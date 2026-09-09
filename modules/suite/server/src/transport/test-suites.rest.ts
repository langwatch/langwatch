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
  type PlatformUrlBuilder,
} from "@langwatch/api/rest";
import { runActorFromRequest, type ScenarioTestSuite } from "@langwatch/scenario-contract";
import { MAX_PLAN_NAME_LENGTH, SuiteApi, SuiteNotFoundError } from "@langwatch/suite-contract";
import { z } from "zod";

import {
  queryBoolean,
  runPlanRunResultSchema,
  suiteSurfaceFact,
  testSuiteDetailWireSchema,
  testSuiteRunInputSchema,
  testSuiteWireSchema,
  toRunItemsWire,
} from "../rules/suite-wire-v1.rules.ts";

const idParamsSchema = z.object({ id: z.string().min(1).describe("The test suite id.") });

const listQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived test suites in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

const nameInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .describe("The test suite name, as it reads in the platform."),
});

const archiveResultSchema = z.object({
  id: z.string().describe("The test suite that was archived."),
  archived: z.literal(true).describe("Always true once the suite is archived."),
});

const notFound = documentedResponses({ 404: badRequestSchema });

/** What a route knows about the project and the person behind the credential. */
type ProjectFacts = z.output<typeof projectRestFacts.schema>;

function suiteWire(params: {
  platformUrl: PlatformUrlBuilder;
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
    archivedAt: suite.archivedAt?.toISOString() ?? null,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
    platformUrl: params.platformUrl({
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
  platformUrl: PlatformUrlBuilder;
  projectId: string;
  projectSlug: string;
  planId: string;
}): Promise<string> {
  const found = await params.app.getByIdOrTestSuite({
    id: params.planId,
    projectId: params.projectId,
  });
  if (found.kind !== "suite") throw new SuiteNotFoundError("Run plan not found");

  return params.platformUrl({
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
  platformUrl: PlatformUrlBuilder;
}): Promise<z.infer<typeof testSuiteDetailWireSchema>> {
  const suite = await readTestSuite(params);
  const scenarios = await params.app.resolveActiveScenarioNames({
    scenarioIds: suite.scenarioIds,
    projectId: params.projectId,
  });

  return {
    ...suiteWire({ platformUrl: params.platformUrl, projectSlug: params.projectSlug, suite }),
    scenarios,
  };
}

/** Renames the suite this id names, refusing a run plan id as a miss. */
async function renameTestSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof idParamsSchema> & z.infer<typeof nameInputSchema>;
  projectId: string;
  projectSlug: string;
  platformUrl: PlatformUrlBuilder;
}): Promise<z.infer<typeof testSuiteWireSchema>> {
  await readTestSuite({ app: params.app, id: params.input.id, projectId: params.projectId });
  const suite = await params.app.renameTestSuite({
    testSuiteId: params.input.id,
    projectId: params.projectId,
    name: params.input.name,
  });

  return suiteWire({ platformUrl: params.platformUrl, projectSlug: params.projectSlug, suite });
}

/** Archives the suite this id names, and the scenarios filed in it. */
async function archiveTestSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof archiveResultSchema>> {
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
  input: z.infer<typeof idParamsSchema> & z.infer<typeof testSuiteRunInputSchema>;
  projectId: string;
  project: ProjectFacts;
  surface: string | null;
  platformUrl: PlatformUrlBuilder;
}): Promise<z.infer<typeof runPlanRunResultSchema>> {
  const { app, input, projectId } = params;
  await readTestSuite({ app, id: input.id, projectId });
  const actor = runActorFromRequest({
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
      platformUrl: params.platformUrl,
      projectId,
      projectSlug: params.project.projectSlug,
      planId: result.suiteId,
    }),
  };
}

/** The `/api/v1/test-suites` collection, item and run endpoints. */
export function createTestSuitesRest(platformUrl: PlatformUrlBuilder) {
  return defineRestRouter(SuiteApi)
    .withNamespace("test-suites")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("v1-only")

    .get("/", "listTestSuites")
    .withQuery(listQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(z.array(testSuiteWireSchema))
    .withDocs({
      tags: ["Test Suites"],
      description:
        "List the project's test suites. Archived suites are left out unless includeArchived is set. Run plans are not test suites and are listed by the run plans family.",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      (await app.listTestSuites({ projectId: scope.id, includeArchived: input.includeArchived })).map(
        (suite) => suiteWire({ platformUrl, projectSlug: project.projectSlug, suite }),
      ),
    )

    .post("/", "createTestSuite")
    .withInput(nameInputSchema)
    .withPermission("scenarios:create")
    .withOutput(testSuiteWireSchema)
    .withStatus(201)
    .withDocs({
      tags: ["Test Suites"],
      description:
        "Create a test suite. It starts empty: scenarios join it by being filed into it, and the targets a run goes against are sent with the run.",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      suiteWire({
        platformUrl,
        projectSlug: project.projectSlug,
        suite: await app.createTestSuite({ projectId: scope.id, name: input.name }),
      }),
    )

    .get("/:id", "getTestSuite")
    .withParams(idParamsSchema)
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
        platformUrl,
      }),
    )

    .patch("/:id", "renameTestSuite")
    .withParams(idParamsSchema)
    .withInput(nameInputSchema)
    .withPermission("scenarios:update")
    .withOutput(testSuiteWireSchema)
    .withDocs({
      tags: ["Test Suites"],
      description:
        "Rename a test suite. The slug is kept, so links and run history stay where they are.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      renameTestSuite({
        app,
        input,
        projectId: scope.id,
        projectSlug: project.projectSlug,
        platformUrl,
      }),
    )

    .delete("/:id", "archiveTestSuite")
    .withParams(idParamsSchema)
    .withPermission("scenarios:manage")
    .withOutput(archiveResultSchema)
    .withDocs({
      tags: ["Test Suites"],
      description:
        "Archive a test suite. The scenarios filed in it are archived with it, in one step, because the suite is where they live.",
      responses: notFound,
    })
    .handle(({ app, input, scope }) =>
      archiveTestSuite({ app, id: input.id, projectId: scope.id }),
    )

    .post("/:id/run", "runTestSuite")
    .withParams(idParamsSchema)
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
      runTestSuite({ app, input, projectId: scope.id, project, surface, platformUrl }),
    )
    .build();
}
