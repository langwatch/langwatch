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
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { deriveRunActor } from "@langwatch/scenario-contract";
import {
  SuiteApi,
  SuiteNotFoundError,
  runPlanWireSchema,
  type RunPlanWire,
  type SuiteRunResult,
  runPlanIdParamsSchema,
  runPlanListQuerySchema,
  runPlanArchiveResultSchema,
} from "@langwatch/suite-contract";
import { z } from "zod";

import {
  rerunInputSchema,
  runPlanRunInputSchema,
  runPlanRunResultSchema,
  suiteRunOriginFact,
  toRunItemsWire,
} from "../rules/suite-wire-v1.rules.ts";

const notFound = documentedResponses({ 404: badRequestSchema });

/** What a route knows about the project and the person behind the credential. */
type ProjectFacts = z.output<typeof projectRestFacts.schema>;

/** What every run of this family answers with. */
function runWire(params: {
  result: SuiteRunResult & { suiteId?: string; planName?: string; created?: boolean };
  plan: RunPlanWire;
}): z.infer<typeof runPlanRunResultSchema> {
  const { result, plan } = params;

  return {
    scheduled: true,
    batchRunId: result.batchRunId,
    setId: result.setId,
    jobCount: result.jobCount,
    skippedArchived: result.skippedArchived,
    items: toRunItemsWire(result.items),
    runPlanId: result.suiteId ?? plan.id,
    planName: result.planName ?? plan.name,
    created: result.created ?? false,
    platformUrl: plan.platformUrl,
  };
}

/** Runs a configuration under a name, and answers with the plan it resolved. */
async function runConfiguration(params: {
  app: SuiteApi;
  input: z.infer<typeof runPlanRunInputSchema>;
  projectId: string;
  project: ProjectFacts;
  surface: string | null;
  callerKey: string | null;
}): Promise<z.infer<typeof runPlanRunResultSchema>> {
  const { app, input, projectId } = params;
  const actor = deriveRunActor({
    userId: params.project.viewerUserId,
    surfaceHeader: params.surface,
    apiKeyId: params.callerKey,
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
  const plan = await app.getRunPlan({
    id: result.suiteId,
    projectId,
    projectSlug: params.project.projectSlug,
  });

  return runWire({ result, plan });
}

/** Runs a stored plan again, with the configuration it already holds. */
async function rerunStoredPlan(params: {
  app: SuiteApi;
  input: z.infer<typeof runPlanIdParamsSchema> & z.infer<typeof rerunInputSchema>;
  projectId: string;
  project: ProjectFacts;
  surface: string | null;
  callerKey: string | null;
}): Promise<z.infer<typeof runPlanRunResultSchema>> {
  const { app, input, projectId } = params;
  const plan = await app.getRunPlan({
    id: input.id,
    projectId,
    projectSlug: params.project.projectSlug,
  });
  const actor = deriveRunActor({
    userId: params.project.viewerUserId,
    surfaceHeader: params.surface,
    apiKeyId: params.callerKey,
  });
  // Any refusal (a missing target, an archived scenario, ...) is a
  // `HandledError` the process's own boundary already serializes.
  const result = await app.run({
    id: plan.id,
    projectId,
    idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
    ...(input.parameters !== undefined && { parameters: input.parameters }),
    ...(input.note !== undefined && { note: input.note }),
    ...(actor !== undefined && { actor }),
  });

  return runWire({ result, plan });
}

/** Archives the plan this id names, refusing a test suite id as a miss. */
async function archivePlan(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof runPlanArchiveResultSchema>> {
  const found = await params.app.getByIdOrTestSuite({ id: params.id, projectId: params.projectId });
  if (found.kind !== "suite" || found.suite.kind !== "run_plan") {
    throw new SuiteNotFoundError("Run plan not found");
  }
  await params.app.archive({ id: found.suite.id, projectId: params.projectId });

  return { id: found.suite.id, archived: true };
}

/** The `/api/v1/run-plans` collection and item endpoints. */
export function createRunPlansRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<SuiteApi>;
}> {
  return defineRestRouter(SuiteApi)
    .withNamespace("run-plans")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("v1-only")

    .get("/", "listRunPlans")
    .withQuery(runPlanListQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(z.array(runPlanWireSchema))
    .withDocs({
      tags: ["Run Plans"],
      description:
        "List the project's run plans. Archived plans are left out unless includeArchived is set. Test suites are not run plans and are listed by the test suites family.",
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      app.listRunPlans({
        projectId: scope.id,
        projectSlug: project.projectSlug,
        includeArchived: input.includeArchived,
      }),
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
    .withMiddleware(projectRestFacts, suiteRunOriginFact)
    .handle(({ app, input, scope }, project, origin) =>
      runConfiguration({
        app,
        input,
        projectId: scope.id,
        project,
        surface: origin.surface,
        callerKey: origin.callerKey,
      }),
    )

    .get("/:id", "getRunPlan")
    .withParams(runPlanIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(runPlanWireSchema)
    .withDocs({
      tags: ["Run Plans"],
      description:
        "Read one run plan. An id the project does not hold, and a test suite id, both answer 404 suite_not_found.",
      responses: notFound,
    })
    .withMiddleware(projectRestFacts)
    .handle(({ app, input, scope }, project) =>
      app.getRunPlan({ id: input.id, projectId: scope.id, projectSlug: project.projectSlug }),
    )

    .post("/:id/run", "rerunRunPlan")
    .withParams(runPlanIdParamsSchema)
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
    .withMiddleware(projectRestFacts, suiteRunOriginFact)
    .handle(({ app, input, scope }, project, origin) =>
      rerunStoredPlan({
        app,
        input,
        projectId: scope.id,
        project,
        surface: origin.surface,
        callerKey: origin.callerKey,
      }),
    )

    .delete("/:id", "archiveRunPlan")
    .withParams(runPlanIdParamsSchema)
    .withPermission("scenarios:manage")
    .withOutput(runPlanArchiveResultSchema)
    .withDocs({
      tags: ["Run Plans"],
      description:
        "Archive a run plan. The plan stops being listed and its run history is kept. The scenarios it referenced are left where they are.",
      responses: notFound,
    })
    .handle(({ app, input, scope }) => archivePlan({ app, id: input.id, projectId: scope.id }))
    .build();
}
