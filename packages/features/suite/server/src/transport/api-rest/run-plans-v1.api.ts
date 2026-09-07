/**
 * The `/api/v1/run-plans` REST family.
 */
import { randomUUID } from "node:crypto";
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  credentialPrincipalOf,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";
import { runActorFromRequest } from "@langwatch/scenario-contract";
import { parseSuiteScope, type Suite, SuiteNotFoundError } from "@langwatch/suite-contract";
import { z } from "zod";
import type { SuiteApp } from "#app/suite.app";
import {
  queryBoolean,
  rerunInputSchema,
  runPlanRunInputSchema,
  runPlanRunResultSchema,
  runPlanWireSchema,
  toRunItemsWire,
} from "../../rules/suite-wire-v1.rules.ts";

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

/** The person the credential belongs to; nothing for a project or service key. */
function callerUserIdOf(c: ProjectScopedContext<EndpointVariables>): string | null {
  const principal = credentialPrincipalOf(c);
  return principal.kind === "apiKey" ? principal.userId : null;
}

/** Builds the `/api/v1/run-plans` collection and item endpoints. */
export function createRunPlansV1RestApp(options: {
  security: AppRestSecurity;
  suites: () => SuiteApp;
  platformUrl: PlatformUrlBuilder;
}): MountableRestApp {
  const { security, suites, platformUrl } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "run-plans",
    basePath: "/api/v1/run-plans",
    errorEnvelope: "legacy",
    staticGeneration: "v1",
  });

  type RunPlanContext = ProjectScopedContext<EndpointVariables>;

  const actorOf = (c: RunPlanContext) =>
    runActorFromRequest({
      userId: callerUserIdOf(c),
      surfaceHeader: c.req.header("X-LangWatch-Surface"),
    });

  const listHandler = async (c: RunPlanContext, input: z.infer<typeof listQuerySchema>) => {
    const project = projectOf(c);
    const rows = await suites().list({
      projectId: project.id,
      includeArchived: input.includeArchived,
    });
    return rows.map((suite) => planWire({ platformUrl, projectSlug: project.slug, suite }));
  };

  const runHandler = async (c: RunPlanContext, input: z.infer<typeof runPlanRunInputSchema>) => {
    const project = projectOf(c);
    const actor = actorOf(c);
    const result = await suites().runPlan({
      projectId: project.id,
      ...(input.name !== undefined && { name: input.name }),
      config: input.config,
      idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
      ...(input.parameters !== undefined && { parameters: input.parameters }),
      ...(input.note !== undefined && { note: input.note }),
      ...(actor !== undefined && { actor }),
    });
    const plan = await readPlan({ suites: suites(), id: result.suiteId, projectId: project.id });
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
      platformUrl: planUrl({ platformUrl, projectSlug: project.slug, suite: plan }),
    };
  };

  const getHandler = async (c: RunPlanContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    const suite = await readPlan({ suites: suites(), id: input.id, projectId: project.id });
    return planWire({ platformUrl, projectSlug: project.slug, suite });
  };

  const rerunHandler = async (
    c: RunPlanContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof rerunInputSchema>,
  ) => {
    const project = projectOf(c);
    const suite = await readPlan({ suites: suites(), id: input.id, projectId: project.id });
    const actor = actorOf(c);

    // Any refusal (a missing target, an archived scenario, ...) is a
    // `HandledError` the process's own boundary already serializes.
    const result = await suites().run({
      id: suite.id,
      projectId: project.id,
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
      runPlanId: suite.id,
      planName: suite.name,
      created: false,
      platformUrl: planUrl({ platformUrl, projectSlug: project.slug, suite }),
    };
  };

  const archiveHandler = async (c: RunPlanContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    const suite = await readPlan({ suites: suites(), id: input.id, projectId: project.id });
    await suites().archive({ id: suite.id, projectId: project.id });
    return { id: suite.id, archived: true as const };
  };

  const notFoundResponse = {
    404: {
      description: "Run plan not found",
      content: { "application/json": { schema: resolver(badRequestSchema) } },
    },
  };

  return service
    .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
      policy(requires("scenarios:view"))(b)
        .withQuery(listQuerySchema)
        .withOutput(z.array(runPlanWireSchema))
        .withDocs({
          operationId: "listRunPlans",
          tags: ["Run Plans"],
          description:
            "List the project's run plans. Archived plans are left out unless includeArchived is set. Test suites are not run plans and are listed by the test suites family.",
          responses: {
            ...baseResponses,
            200: {
              description: "Success",
              content: {
                "application/json": { schema: resolver(z.array(runPlanWireSchema)) },
              },
            },
          },
        }),
    )
    .registerRoute("post", "/run", MANAGEMENT_API_VERSION, runHandler, (b) =>
      policy(requires("scenarios:create"))(b)
        .withInput(runPlanRunInputSchema)
        .withOutput(runPlanRunResultSchema)
        .withDocs({
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
    )
    .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
      policy(requires("scenarios:view"))(b)
        .withParams(idParamsSchema)
        .withOutput(runPlanWireSchema)
        .withDocs({
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
            ...notFoundResponse,
          },
        }),
    )
    .registerRoute("post", "/:id/run", MANAGEMENT_API_VERSION, rerunHandler, (b) =>
      policy(requires("scenarios:create"))(b)
        .withParams(idParamsSchema)
        .withInput(rerunInputSchema)
        .withOutput(runPlanRunResultSchema)
        .withDocs({
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
            ...notFoundResponse,
          },
        }),
    )
    .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
      policy(requires("scenarios:manage"))(b)
        .withParams(idParamsSchema)
        .withOutput(archiveResultSchema)
        .withDocs({
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
            ...notFoundResponse,
          },
        }),
    )
    .build();
}
