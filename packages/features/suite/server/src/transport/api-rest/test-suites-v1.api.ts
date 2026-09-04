/**
 * The `/api/v1/test-suites` REST family.
 *
 * A TEST SUITE is a group of scenarios. It holds what it collects and nothing
 * about how a run of it is executed, so the targets, the repeat count and the
 * models arrive with the run request and are written onto the run plan that
 * run resolves.
 *
 * Run plans are the other half of the model and live in their own family,
 * `/api/v1/run-plans`. `/api/suites` is the deprecated alias that predates the
 * split.
 */
import { randomUUID } from "node:crypto";
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type PlatformUrlBuilder,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { runActorFromRequest, type ScenarioTestSuite } from "@langwatch/scenario-contract";
import { MAX_PLAN_NAME_LENGTH, SuiteNotFoundError } from "@langwatch/suite-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { SuiteApp } from "#app/suite.app";
import {
  queryBoolean,
  runPlanRunResultSchema,
  testSuiteDetailWireSchema,
  testSuiteRunInputSchema,
  testSuiteWireSchema,
  toRunItemsWire,
} from "./suite-wire-v1";

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
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, suites, platformUrl } = options;
  const secured = security.createProjectApp({ basePath: "/api/v1/test-suites" });

  secured.access(requires("scenarios:view")).get(
    "/",
    describeRoute({
      operationId: "listTestSuites",
      tags: ["Test Suites"],
      description:
        "List the project's test suites. Archived suites are left out unless includeArchived is set. Run plans are not test suites and are listed by the run plans family.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(z.array(testSuiteWireSchema)) } },
        },
      },
    }),
    zValidator("query", listQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { includeArchived } = c.req.valid("query");
      const rows = await suites().listTestSuites({ projectId: project.id, includeArchived });
      return c.json(
        rows.map((suite) => suiteWire({ platformUrl, projectSlug: project.slug, suite })),
      );
    },
  );

  secured.access(requires("scenarios:create")).post(
    "/",
    describeRoute({
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
    zValidator("json", nameInputSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      const suite = await suites().createTestSuite({ projectId: project.id, name: body.name });
      return c.json(suiteWire({ platformUrl, projectSlug: project.slug, suite }), 201);
    },
  );

  secured.access(requires("scenarios:view")).get(
    "/:id",
    describeRoute({
      operationId: "getTestSuite",
      tags: ["Test Suites"],
      summary: "Read one test suite",
      description:
        "Read one test suite with the scenarios filed in it, named. An id the project does not hold, and a run plan id, both answer 404 suite_not_found.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(testSuiteDetailWireSchema) } },
        },
        404: {
          description: "Test suite not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      const app = suites();
      const suite = await readTestSuite({ suites: app, id, projectId: project.id });
      const scenarios = await app.resolveActiveScenarioNames({
        scenarioIds: suite.scenarioIds,
        projectId: project.id,
      });
      return c.json({ ...suiteWire({ platformUrl, projectSlug: project.slug, suite }), scenarios });
    },
  );

  secured.access(requires("scenarios:update")).patch(
    "/:id",
    describeRoute({
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
        404: {
          description: "Test suite not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    zValidator("json", nameInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await readTestSuite({ suites: suites(), id, projectId: project.id });
      const suite = await suites().renameTestSuite({
        testSuiteId: id,
        projectId: project.id,
        name: body.name,
      });
      return c.json(suiteWire({ platformUrl, projectSlug: project.slug, suite }));
    },
  );

  secured.access(requires("scenarios:manage")).delete(
    "/:id",
    describeRoute({
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
        404: {
          description: "Test suite not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      await readTestSuite({ suites: suites(), id, projectId: project.id });
      await suites().archiveTestSuite({ testSuiteId: id, projectId: project.id });
      return c.json({ id, archived: true as const });
    },
  );

  secured.access(requires("scenarios:create")).post(
    "/:id/run",
    describeRoute({
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
        404: {
          description: "Test suite not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    zValidator("json", testSuiteRunInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
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
        ...(body.name !== undefined && { name: body.name }),
        config: {
          scope: { mode: "test_suites", testSuiteIds: [id] },
          targets: body.targets,
          ...(body.repeatCount !== undefined && { repeatCount: body.repeatCount }),
          ...(body.simulatorModel !== undefined && { simulatorModel: body.simulatorModel }),
          ...(body.judgeModel !== undefined && { judgeModel: body.judgeModel }),
        },
        idempotencyKey: body.idempotencyKey ?? `api-${randomUUID()}`,
        ...(body.parameters !== undefined && { parameters: body.parameters }),
        ...(body.note !== undefined && { note: body.note }),
        ...(actor !== undefined && { actor }),
      });

      return c.json({
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
      });
    },
  );

  return secured;
}
