/**
 * The `/api/v1/run-plans` REST family: the plans a project runs, and the runs
 * they start. The family carries its generation in its own path, so it is
 * addressed only under `/api/v1`.
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
import { runActorFromRequest } from "@langwatch/scenario-contract";
import {
  parseSuiteScope,
  SuiteApi,
  SuiteNotFoundError,
  type Suite,
  type SuiteRunResult,
} from "@langwatch/suite-contract";
import { z } from "zod";

import {
  rerunInputSchema,
  runPlanRunInputSchema,
  runPlanRunResultSchema,
  runPlanWireSchema,
  suiteSurfaceFact,
  queryBoolean,
  toRunItemsWire,
} from "../rules/suite-wire-v1.rules.ts";

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

const notFound = documentedResponses({ 404: badRequestSchema });

/** What a route knows about the project and the person behind the credential. */
type ProjectFacts = z.output<typeof projectRestFacts.schema>;

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
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<Suite> {
  const found = await params.app.getByIdOrTestSuite({ id: params.id, projectId: params.projectId });
  if (found.kind !== "suite" || found.suite.kind !== "run_plan") {
    throw new SuiteNotFoundError("Run plan not found");
  }

  return found.suite;
}

/** What every run of this family answers with. */
function runWire(params: {
  result: SuiteRunResult & { suiteId?: string; planName?: string; created?: boolean };
  suite: Suite;
  platformUrl: PlatformUrlBuilder;
  projectSlug: string;
}): z.infer<typeof runPlanRunResultSchema> {
  const { result, suite } = params;

  return {
    scheduled: true,
    batchRunId: result.batchRunId,
    setId: result.setId,
    jobCount: result.jobCount,
    skippedArchived: result.skippedArchived,
    items: toRunItemsWire(result.items),
    runPlanId: result.suiteId ?? suite.id,
    planName: result.planName ?? suite.name,
    created: result.created ?? false,
    platformUrl: planUrl({ platformUrl: params.platformUrl, projectSlug: params.projectSlug, suite }),
  };
}

/** Runs a configuration under a name, and answers with the plan it resolved. */
async function runConfiguration(params: {
  app: SuiteApi;
  input: z.infer<typeof runPlanRunInputSchema>;
  projectId: string;
  project: ProjectFacts;
  surface: string | null;
  platformUrl: PlatformUrlBuilder;
}): Promise<z.infer<typeof runPlanRunResultSchema>> {
  const { app, input, projectId } = params;
  const actor = runActorFromRequest({
    userId: params.project.viewerUserId,
    surfaceHeader: params.surface,
  });
  const result = await app.runPlan({
    projectId,
    ...(input.name !== undefined && { name: input.name }),
    config: input.config,
    idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
    ...(input.parameters !== undefined && { parameters: input.parameters }),
    ...(input.note !== undefined && { note: input.note }),
    ...(actor !== undefined && { actor }),
  });
  const suite = await readPlan({ app, id: result.suiteId, projectId });

  return runWire({
    result,
    suite,
    platformUrl: params.platformUrl,
    projectSlug: params.project.projectSlug,
  });
}

/** Runs a stored plan again, with the configuration it already holds. */
async function rerunStoredPlan(params: {
  app: SuiteApi;
  input: z.infer<typeof idParamsSchema> & z.infer<typeof rerunInputSchema>;
  projectId: string;
  project: ProjectFacts;
  surface: string | null;
  platformUrl: PlatformUrlBuilder;
}): Promise<z.infer<typeof runPlanRunResultSchema>> {
  const { app, input, projectId } = params;
  const suite = await readPlan({ app, id: input.id, projectId });
  const actor = runActorFromRequest({
    userId: params.project.viewerUserId,
    surfaceHeader: params.surface,
  });
  // Any refusal (a missing target, an archived scenario, ...) is a
  // `HandledError` the process's own boundary already serializes.
  const result = await app.run({
    id: suite.id,
    projectId,
    idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
    ...(input.parameters !== undefined && { parameters: input.parameters }),
    ...(input.note !== undefined && { note: input.note }),
    ...(actor !== undefined && { actor }),
  });

  return runWire({
    result,
    suite,
    platformUrl: params.platformUrl,
    projectSlug: params.project.projectSlug,
  });
}

/** Archives the plan this id names, refusing a test suite id as a miss. */
async function archivePlan(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof archiveResultSchema>> {
  const suite = await readPlan(params);
  await params.app.archive({ id: suite.id, projectId: params.projectId });

  return { id: suite.id, archived: true };
}

/** The `/api/v1/run-plans` collection and item endpoints. */
export function createRunPlansRest(platformUrl: PlatformUrlBuilder) {
  return defineRestRouter(SuiteApi)
    .withNamespace("run-plans")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("v1-only")

    .get("/", "listRunPlans")
    .withQuery(listQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(z.array(runPlanWireSchema))
    .withDocs({
      tags: ["Run Plans"],
      description:
        "List the project's run plans. Archived plans are left out unless includeArchived is set. Test suites are not run plans and are listed by the test suites family.",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      (await app.list({ projectId: scope.id, includeArchived: input.includeArchived })).map(
        (suite) => planWire({ platformUrl, projectSlug: project.projectSlug, suite }),
      ),
    )

    .post("/run", "runRunPlan")
    .withInput(runPlanRunInputSchema)
    .withPermission("scenarios:create")
    .withOutput(runPlanRunResultSchema)
    .withDocs({
      tags: ["Run Plans"],
      description:
        "Run a configuration under a name. The name identifies the run plan: send a name already in use and that plan's configuration is replaced with this one, send a new name and the plan is created, send no name and one is derived from what the run covers and what it runs against.",
    })
    .withMiddleware(projectRestFacts, suiteSurfaceFact)
    .handle(({ app, input, scope }, project, surface) =>
      runConfiguration({ app, input, projectId: scope.id, project, surface, platformUrl }),
    )

    .get("/:id", "getRunPlan")
    .withParams(idParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(runPlanWireSchema)
    .withDocs({
      tags: ["Run Plans"],
      description:
        "Read one run plan. An id the project does not hold, and a test suite id, both answer 404 suite_not_found.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) =>
      planWire({
        platformUrl,
        projectSlug: project.projectSlug,
        suite: await readPlan({ app, id: input.id, projectId: scope.id }),
      }),
    )

    .post("/:id/run", "rerunRunPlan")
    .withParams(idParamsSchema)
    .withInput(rerunInputSchema)
    .withPermission("scenarios:create")
    .withOutput(runPlanRunResultSchema)
    .withDocs({
      tags: ["Run Plans"],
      summary: "Run a plan again",
      description:
        "Run a run plan again, with the configuration it already holds. To run a different configuration, post it to /run under the plan's name.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts, suiteSurfaceFact)
    .handle(({ app, input, scope }, project, surface) =>
      rerunStoredPlan({ app, input, projectId: scope.id, project, surface, platformUrl }),
    )

    .delete("/:id", "archiveRunPlan")
    .withParams(idParamsSchema)
    .withPermission("scenarios:manage")
    .withOutput(archiveResultSchema)
    .withDocs({
      tags: ["Run Plans"],
      description:
        "Archive a run plan. The plan stops being listed and its run history is kept. The scenarios it referenced are left where they are.",
      responses: notFound,
    })
    .handle(({ app, input, scope }) =>
      archivePlan({ app, id: input.id, projectId: scope.id }),
    )
    .build();
}
