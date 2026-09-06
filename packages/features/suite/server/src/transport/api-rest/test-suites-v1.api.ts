/**
 * The `/api/v1/test-suites` REST family.
 */
import { randomUUID } from "node:crypto";
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";
import { runActorFromRequest, type ScenarioTestSuite } from "@langwatch/scenario-contract";
import { MAX_PLAN_NAME_LENGTH, SuiteNotFoundError } from "@langwatch/suite-contract";
import { z } from "zod";
import type { SuiteApp } from "#app/suite.app";
import {
  queryBoolean,
  runPlanRunResultSchema,
  testSuiteDetailWireSchema,
  testSuiteRunInputSchema,
  testSuiteWireSchema,
  toRunItemsWire,
} from "../../rules/suite-wire-v1.rules.ts";

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
  suites: SuiteApp;
  id: string;
  projectId: string;
}): Promise<ScenarioTestSuite> {
  const found = await params.suites.getByIdOrTestSuite({
    id: params.id,
    projectId: params.projectId,
  });
  if (found.kind !== "test_suite") throw new SuiteNotFoundError("Test suite not found");
  return found.testSuite;
}

/** Where the run plan a run was filed under opens in the platform. */
async function resolvedPlanUrl(params: {
  suites: SuiteApp;
  platformUrl: PlatformUrlBuilder;
  projectId: string;
  projectSlug: string;
  planId: string;
}): Promise<string> {
  const found = await params.suites.getByIdOrTestSuite({
    id: params.planId,
    projectId: params.projectId,
  });
  if (found.kind !== "suite") throw new SuiteNotFoundError("Run plan not found");
  return params.platformUrl({
    projectSlug: params.projectSlug,
    path: `/simulations/run-plans/${found.suite.slug}`,
  });
}

/** Builds the `/api/v1/test-suites` collection, item and run endpoints. */
export function createTestSuitesV1RestApp(options: {
  security: AppRestSecurity;
  suites: () => SuiteApp;
  platformUrl: PlatformUrlBuilder;
}): MountableRestApp {
  const { security, suites, platformUrl } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "test-suites",
    basePath: "/api/v1/test-suites",
    errorEnvelope: "legacy",
    staticGeneration: "v1",
  });

  type TestSuiteContext = ProjectScopedContext<EndpointVariables>;

  const listHandler = async (c: TestSuiteContext, input: z.infer<typeof listQuerySchema>) => {
    const project = projectOf(c);
    const rows = await suites().listTestSuites({
      projectId: project.id,
      includeArchived: input.includeArchived,
    });
    return rows.map((suite) => suiteWire({ platformUrl, projectSlug: project.slug, suite }));
  };

  const createHandler = async (c: TestSuiteContext, input: z.infer<typeof nameInputSchema>) => {
    const project = projectOf(c);
    const suite = await suites().createTestSuite({ projectId: project.id, name: input.name });
    return suiteWire({ platformUrl, projectSlug: project.slug, suite });
  };

  const getHandler = async (c: TestSuiteContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    const app = suites();
    const suite = await readTestSuite({ suites: app, id: input.id, projectId: project.id });
    const scenarios = await app.resolveActiveScenarioNames({
      scenarioIds: suite.scenarioIds,
      projectId: project.id,
    });
    return { ...suiteWire({ platformUrl, projectSlug: project.slug, suite }), scenarios };
  };

  const renameHandler = async (
    c: TestSuiteContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof nameInputSchema>,
  ) => {
    const project = projectOf(c);
    await readTestSuite({ suites: suites(), id: input.id, projectId: project.id });
    const suite = await suites().renameTestSuite({
      testSuiteId: input.id,
      projectId: project.id,
      name: input.name,
    });
    return suiteWire({ platformUrl, projectSlug: project.slug, suite });
  };

  const archiveHandler = async (c: TestSuiteContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    await readTestSuite({ suites: suites(), id: input.id, projectId: project.id });
    await suites().archiveTestSuite({ testSuiteId: input.id, projectId: project.id });
    return { id: input.id, archived: true as const };
  };

  const runHandler = async (
    c: TestSuiteContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof testSuiteRunInputSchema>,
  ) => {
    const project = projectOf(c);
    const { id } = input;
    const app = suites();
    await readTestSuite({ suites: app, id, projectId: project.id });
    const actor = runActorFromRequest({
      userId: c.get("apiKeyUserId"),
      surfaceHeader: c.req.header("X-LangWatch-Surface"),
    });

    // Filed under the run plan the scope resolves: a test suite's own runs
    // live in the same run-plan history as every other run of it.
    const result = await app.runPlan({
      projectId: project.id,
      ...(input.name !== undefined && { name: input.name }),
      config: {
        scope: { mode: "test_suites", testSuiteIds: [id] },
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
        suites: app,
        platformUrl,
        projectId: project.id,
        projectSlug: project.slug,
        planId: result.suiteId,
      }),
    };
  };

  const notFoundResponse = {
    404: {
      description: "Test suite not found",
      content: { "application/json": { schema: resolver(badRequestSchema) } },
    },
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("scenarios:view"))(b)
          .withQuery(listQuerySchema)
          .withOutput(z.array(testSuiteWireSchema))
          .withDocs({
            operationId: "listTestSuites",
            tags: ["Test Suites"],
            description:
              "List the project's test suites. Archived suites are left out unless includeArchived is set. Run plans are not test suites and are listed by the run plans family.",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: {
                  "application/json": { schema: resolver(z.array(testSuiteWireSchema)) },
                },
              },
            },
          }),
      )
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("scenarios:create"))(b)
          .withInput(nameInputSchema)
          .withOutput(testSuiteWireSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createTestSuite",
            tags: ["Test Suites"],
            description:
              "Create a test suite. It starts empty: scenarios join it by being filed into it, and the targets a run goes against are sent with the run.",
            responses: {
              ...baseResponses,
              201: {
                description: "Test suite created",
                content: { "application/json": { schema: resolver(testSuiteWireSchema) } },
              },
            },
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("scenarios:view"))(b)
          .withParams(idParamsSchema)
          .withOutput(testSuiteDetailWireSchema)
          .withDocs({
            operationId: "getTestSuite",
            tags: ["Test Suites"],
            summary: "Read one test suite",
            description:
              "Read one test suite with the scenarios filed in it, named. An id the project does not hold, and a run plan id, both answer 404 suite_not_found.",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: {
                  "application/json": { schema: resolver(testSuiteDetailWireSchema) },
                },
              },
              ...notFoundResponse,
            },
          }),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, renameHandler, (b) =>
        policy(requires("scenarios:update"))(b)
          .withParams(idParamsSchema)
          .withInput(nameInputSchema)
          .withOutput(testSuiteWireSchema)
          .withDocs({
            operationId: "renameTestSuite",
            tags: ["Test Suites"],
            description:
              "Rename a test suite. The slug is kept, so links and run history stay where they are.",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: { "application/json": { schema: resolver(testSuiteWireSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requires("scenarios:manage"))(b)
          .withParams(idParamsSchema)
          .withOutput(archiveResultSchema)
          .withDocs({
            operationId: "archiveTestSuite",
            tags: ["Test Suites"],
            description:
              "Archive a test suite. The scenarios filed in it are archived with it, in one step, because the suite is where they live.",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: { "application/json": { schema: resolver(archiveResultSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      .registerRoute("post", "/:id/run", MANAGEMENT_API_VERSION, runHandler, (b) =>
        policy(requires("scenarios:create"))(b)
          .withParams(idParamsSchema)
          .withInput(testSuiteRunInputSchema)
          .withOutput(runPlanRunResultSchema)
          .withDocs({
            operationId: "runTestSuite",
            tags: ["Test Suites"],
            summary: "Run a test suite",
            description:
              "Run every scenario filed in the test suite against the targets sent with the request. The run is filed under a run plan named after the suite and its targets unless a name is sent. A request that names no target answers 422 suite_targets_required.",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: { "application/json": { schema: resolver(runPlanRunResultSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      .build()
  );
}
