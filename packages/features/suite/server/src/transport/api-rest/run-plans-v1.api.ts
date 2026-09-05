/**
 * The `/api/v1/run-plans` REST family.
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
import { runActorFromRequest } from "@langwatch/scenario-contract";
import { parseSuiteScope, type Suite, SuiteNotFoundError } from "@langwatch/suite-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { SuiteApp } from "#app/suite.app";
import {
  queryBoolean,
  rerunInputSchema,
  runPlanRunInputSchema,
  runPlanRunResultSchema,
  runPlanWireSchema,
  toRunItemsWire,
} from "./suite-wire-v1";

const idParamsSchema = z.object({ id: z.string().min(1).describe("The run plan id.") });

const listQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived run plans in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

const archiveResultSchema = z.object({
  id: z.string().describe("The run plan that was archived."),
  archived: z.literal(true).describe("Always true once the plan is archived."),
});

/** Where this plan opens in the platform, for the project's own interface. */
function planUrl(params: {
  platformUrl: PlatformUrlBuilder;
  projectSlug: string;
  suite: Suite;
}): string {
  return params.platformUrl({
    projectSlug: params.projectSlug,
    path: `/simulations/run-plans/${params.suite.slug}`,
  });
}

function planWire(params: {
  platformUrl: PlatformUrlBuilder;
  projectSlug: string;
  suite: Suite;
}): z.infer<typeof runPlanWireSchema> {
  const { suite } = params;
  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    // A row stored before scopes carries null and runs its stored
    // `scenarioIds`; the wire always answers the concrete scope that means.
    scope: parseSuiteScope(suite.scope),
    scenarioIds: suite.scenarioIds,
    targets: suite.targets,
    repeatCount: suite.repeatCount,
    simulatorModel: suite.simulatorModel,
    judgeModel: suite.judgeModel,
    labels: suite.labels,
    archivedAt: suite.archivedAt?.toISOString() ?? null,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
    platformUrl: planUrl(params),
  };
}

/**
 * The row this id names, refusing a test suite id the same way a missing one
 * is refused: the two families address disjoint sets of rows, so an id from
 * one is simply not a member of the other.
 */
async function readPlan(params: {
  suites: SuiteApp;
  id: string;
  projectId: string;
}): Promise<Suite> {
  const found = await params.suites.getByIdOrTestSuite({
    id: params.id,
    projectId: params.projectId,
  });
  if (found.kind !== "suite" || found.suite.kind !== "run_plan") {
    throw new SuiteNotFoundError("Run plan not found");
  }
  return found.suite;
}

/** Builds the `/api/v1/run-plans` collection and item endpoints. */
export function createRunPlansV1RestApp(options: {
  security: AppRestSecurity;
  suites: () => SuiteApp;
  platformUrl: PlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, suites, platformUrl } = options;
  const secured = security.createProjectApp({ basePath: "/api/v1/run-plans" });

  secured.access(requires("scenarios:view")).get(
    "/",
    describeRoute({
      operationId: "listRunPlans",
      tags: ["Run Plans"],
      description:
        "List the project's run plans. Archived plans are left out unless includeArchived is set. Test suites are not run plans and are listed by the test suites family.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(z.array(runPlanWireSchema)) } },
        },
      },
    }),
    zValidator("query", listQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { includeArchived } = c.req.valid("query");
      const rows = await suites().list({ projectId: project.id, includeArchived });
      return c.json(
        rows.map((suite) => planWire({ platformUrl, projectSlug: project.slug, suite })),
      );
    },
  );

  secured.access(requires("scenarios:create")).post(
    "/run",
    describeRoute({
      operationId: "runRunPlan",
      tags: ["Run Plans"],
      description:
        "Run a configuration under a name. The name identifies the run plan: send a name already in use and that plan's configuration is replaced with this one, send a new name and the plan is created, send no name and one is derived from what the run covers and what it runs against.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(runPlanRunResultSchema) } },
        },
      },
    }),
    zValidator("json", runPlanRunInputSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      const actor = runActorFromRequest({
        userId: c.get("apiKeyUserId"),
        surfaceHeader: c.req.header("X-LangWatch-Surface"),
      });
      const result = await suites().runPlan({
        projectId: project.id,
        ...(body.name !== undefined && { name: body.name }),
        config: body.config,
        idempotencyKey: body.idempotencyKey ?? `api-${randomUUID()}`,
        ...(body.parameters !== undefined && { parameters: body.parameters }),
        ...(body.note !== undefined && { note: body.note }),
        ...(actor !== undefined && { actor }),
      });
      const plan = await readPlan({ suites: suites(), id: result.suiteId, projectId: project.id });
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
        platformUrl: planUrl({ platformUrl, projectSlug: project.slug, suite: plan }),
      });
    },
  );

  secured.access(requires("scenarios:view")).get(
    "/:id",
    describeRoute({
      operationId: "getRunPlan",
      tags: ["Run Plans"],
      description:
        "Read one run plan. An id the project does not hold, and a test suite id, both answer 404 suite_not_found.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(runPlanWireSchema) } },
        },
        404: {
          description: "Run plan not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      const suite = await readPlan({ suites: suites(), id, projectId: project.id });
      return c.json(planWire({ platformUrl, projectSlug: project.slug, suite }));
    },
  );

  secured.access(requires("scenarios:create")).post(
    "/:id/run",
    describeRoute({
      operationId: "rerunRunPlan",
      tags: ["Run Plans"],
      summary: "Run a plan again",
      description:
        "Run a run plan again, with the configuration it already holds. To run a different configuration, post it to /run under the plan's name.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(runPlanRunResultSchema) } },
        },
        404: {
          description: "Run plan not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    zValidator("json", rerunInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const suite = await readPlan({ suites: suites(), id, projectId: project.id });
      const actor = runActorFromRequest({
        userId: c.get("apiKeyUserId"),
        surfaceHeader: c.req.header("X-LangWatch-Surface"),
      });

      // Any refusal (a missing target, an archived scenario, ...) is a
      // `HandledError` the process's own boundary already serializes.
      const result = await suites().run({
        id: suite.id,
        projectId: project.id,
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
        runPlanId: suite.id,
        planName: suite.name,
        created: false,
        platformUrl: planUrl({ platformUrl, projectSlug: project.slug, suite }),
      });
    },
  );

  secured.access(requires("scenarios:manage")).delete(
    "/:id",
    describeRoute({
      operationId: "archiveRunPlan",
      tags: ["Run Plans"],
      description:
        "Archive a run plan. The plan stops being listed and its run history is kept. The scenarios it referenced are left where they are.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: { "application/json": { schema: resolver(archiveResultSchema) } },
        },
        404: {
          description: "Run plan not found",
          content: { "application/json": { schema: resolver(badRequestSchema) } },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.valid("param");
      const suite = await readPlan({ suites: suites(), id, projectId: project.id });
      await suites().archive({ id: suite.id, projectId: project.id });
      return c.json({ id: suite.id, archived: true as const });
    },
  );

  return secured;
}
