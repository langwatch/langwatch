/**
 * The deprecated `/api/suites` family: one address for both nouns, from before
 * run plans and test suites were published separately. Every answer names its
 * successors, and the family is addressed exactly as it always was.
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
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  ScenarioTestSuiteNotFoundError,
  type ScenarioTestSuite,
  runActorFromRequest,
} from "@langwatch/scenario-contract";
import type { suiteResponseSchema } from "@langwatch/suite-contract";
import {
  isSuiteKind,
  SuiteApi,
  SuiteExecutionError,
  suiteTargetSchema,
  type Suite,
  type SuiteKind,
  type SuiteScope,
  archivedSuiteSchema,
  createSuiteInputSchema,
  listSuitesQuerySchema,
  runSuiteInputSchema,
  suiteAliasIdParamsSchema,
  suiteResponseWithPlatformUrlSchema,
  suiteRunResultSchema,
  updateSuiteInputSchema,
  type WireScope,
} from "@langwatch/suite-contract";
import { z } from "zod";

import { suiteSurfaceFact, toRunItemsWire } from "../rules/suite-wire-v1.rules.ts";

const logger = createLogger("langwatch:api:suites");

/** The successors, as every answer of the family names them. */
const DEPRECATION = {
  successor: "/api/v1/run-plans",
  notice: "Deprecated: use /api/v1/run-plans and /api/v1/test-suites.",
} as const;

/** A refused run, at the status this family publishes one with. */
class SuiteAliasRunRefusedError extends HandledError {
  constructor(refusal: SuiteExecutionError) {
    super(refusal.code, refusal.message, {
      httpStatus: 400,
      fault: refusal.fault,
      meta: refusal.meta,
      tips: refusal.tips,
    });
    this.name = "SuiteAliasRunRefusedError";
  }
}

/** The refusal for a body that names targets the addressed row does not take. */
function storedTargetsRefusal(operation: "run" | "update"): ValidationError {
  const message =
    operation === "run"
      ? "A run plan runs the targets it stores; send targets only when the id names a test suite"
      : "A test suite gets its targets when a run is started, so it stores none";

  return new ValidationError(message, { meta: { fieldErrors: { targets: [message] } } });
}

/** A scope this family accepted, as the domain reads it. */
function toDomainScope(scope: WireScope): SuiteScope {
  if (scope.mode === "folders") {
    return { mode: "test_suites", testSuiteIds: scope.folderIds };
  }
  if (scope.mode === "cases") return { mode: "scenarios" };

  return scope;
}

/** A stored scope, in the words this family answers with. */
function toWireScope(scope: SuiteScope): WireScope {
  if (scope.mode === "test_suites") {
    return { mode: "folders", folderIds: scope.testSuiteIds };
  }
  if (scope.mode === "scenarios") return { mode: "cases" };

  return scope;
}

/** The suite kinds this family answers with, by the kind the row holds. */
const WIRE_KINDS = {
  test_suite: "folder",
  run_plan: "custom",
} as const satisfies Record<SuiteKind, "folder" | "custom">;

const notFound = documentedResponses({ 404: badRequestSchema });

type SuiteResponse = z.infer<typeof suiteResponseSchema>;
type SuiteResponseWithPlatformUrl = z.infer<typeof suiteResponseWithPlatformUrlSchema>;

function toSuiteResponse(suite: Suite): SuiteResponse {
  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    kind: WIRE_KINDS[isSuiteKind(suite.kind) ? suite.kind : "run_plan"],
    description: suite.description,
    scenarioIds: suite.scenarioIds,
    scope: suite.scope ? toWireScope(suite.scope) : null,
    targets: suite.targets,
    repeatCount: suite.repeatCount,
    labels: suite.labels,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
  };
}

function toTestSuiteResponse(testSuite: ScenarioTestSuite): SuiteResponse {
  const targets = z.array(suiteTargetSchema).parse(testSuite.targets);

  return {
    id: testSuite.id,
    name: testSuite.name,
    slug: testSuite.slug,
    kind: "folder",
    description: testSuite.description,
    scenarioIds: testSuite.scenarioIds,
    scope: null,
    targets,
    repeatCount: testSuite.repeatCount,
    labels: testSuite.labels,
    createdAt: testSuite.createdAt.toISOString(),
    updatedAt: testSuite.updatedAt.toISOString(),
  };
}

const PLAN_PATH = (slug: string) => `/simulations/run-plans/${slug}`;

function withPlatformUrl(params: {
  row: SuiteResponse;
  projectSlug: string;
  app: SuiteApi;
}): SuiteResponseWithPlatformUrl {
  return {
    ...params.row,
    platformUrl: params.app.platformUrl({
      projectSlug: params.projectSlug,
      path: PLAN_PATH(params.row.slug),
    }),
  };
}

async function listSuites(params: {
  app: SuiteApi;
  kind: "custom" | "folder";
  projectId: string;
  projectSlug: string;
}): Promise<SuiteResponseWithPlatformUrl[]> {
  const { app, kind, projectId } = params;
  logger.info({ projectId, kind }, "Listing suites");

  const listed =
    kind === "folder"
      ? (await app.listTestSuites({ projectId })).map(toTestSuiteResponse)
      : (await app.list({ projectId })).map(toSuiteResponse);

  return listed.map((row) => withPlatformUrl({ row, projectSlug: params.projectSlug, app }));
}

/** The row either family holds, in the one shape this alias publishes. */
function eitherResponse(
  found: Readonly<
    { kind: "suite"; suite: Suite } | { kind: "test_suite"; testSuite: ScenarioTestSuite }
  >,
): SuiteResponse {
  return found.kind === "test_suite"
    ? toTestSuiteResponse(found.testSuite)
    : toSuiteResponse(found.suite);
}

async function getSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
  projectSlug: string;
}): Promise<SuiteResponseWithPlatformUrl> {
  logger.info({ projectId: params.projectId, suiteId: params.id }, "Getting suite");

  // The "try the run plan, fall back to the test suite" order is the
  // application's; this door only decides how it words the miss.
  const found = await params.app.getByIdOrTestSuite({ id: params.id, projectId: params.projectId });

  return withPlatformUrl({
    row: eitherResponse(found),
    projectSlug: params.projectSlug,
    app: params.app,
  });
}

async function createSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof createSuiteInputSchema>;
  projectId: string;
  projectSlug: string;
}): Promise<SuiteResponseWithPlatformUrl> {
  const { app, projectId } = params;
  const { kind, scope, ...definition } = params.input;
  logger.info({ projectId, kind }, "Creating suite");

  const row =
    kind === "folder"
      ? toTestSuiteResponse(await app.createTestSuite({ projectId, name: definition.name }))
      : toSuiteResponse(
          await app.create({
            ...definition,
            ...(scope ? { scope: toDomainScope(scope) } : {}),
            projectId,
          }),
        );

  return withPlatformUrl({ row, projectSlug: params.projectSlug, app });
}

/** A test suite stores no target, so an update naming any is malformed. */
async function refuseTargetsOnTestSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<void> {
  const found = await params.app.getByIdOrTestSuite({ id: params.id, projectId: params.projectId });
  if (found.kind === "test_suite") throw storedTargetsRefusal("update");
}

async function updateSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof suiteAliasIdParamsSchema> & z.infer<typeof updateSuiteInputSchema>;
  projectId: string;
  projectSlug: string;
}): Promise<SuiteResponseWithPlatformUrl> {
  const { app, projectId } = params;
  const { suiteId: id, scope, ...fields } = params.input;
  logger.info({ projectId, suiteId: id }, "Updating suite");

  // Whether this id names a test suite, and what a test suite refuses, is the
  // application's decision — the same one the tRPC surface makes.
  if (fields.targets !== undefined) await refuseTargetsOnTestSuite({ app, id, projectId });

  const updated = await app.update({
    id,
    projectId,
    ...fields,
    ...(scope ? { scope: toDomainScope(scope) } : {}),
  });

  return withPlatformUrl({
    row: eitherResponse(updated),
    projectSlug: params.projectSlug,
    app,
  });
}

async function duplicateSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
  projectSlug: string;
}): Promise<SuiteResponseWithPlatformUrl> {
  logger.info({ projectId: params.projectId, suiteId: params.id }, "Duplicating suite");

  const suite = await params.app.duplicate({ id: params.id, projectId: params.projectId });

  return withPlatformUrl({
    row: toSuiteResponse(suite),
    projectSlug: params.projectSlug,
    app: params.app,
  });
}

/**
 * Schedules the run this id names. A test suite stores no target, so the run
 * takes them from the body and is filed under the run plan its scope resolves.
 * A run plan stores its own, so a body naming any is a malformed request.
 */
async function runSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof suiteAliasIdParamsSchema> & z.infer<typeof runSuiteInputSchema>;
  projectId: string;
  viewerUserId: string | null;
  surface: string | null;
}): Promise<z.infer<typeof suiteRunResultSchema>> {
  const { app, input, projectId } = params;
  logger.info({ projectId, suiteId: input.suiteId }, "Running suite");

  // A project key belongs to no person, so it records no actor. A user-bound
  // key records the person it belongs to, through the surface the request
  // declared.
  const actor = runActorFromRequest({
    userId: params.viewerUserId,
    surfaceHeader: params.surface,
  });
  const idempotencyKey = input.idempotencyKey ?? `api-${randomUUID()}`;

  return scheduleRun({ app, input, projectId, idempotencyKey, actor }).catch((error: unknown) =>
    refuseRun(error),
  );
}

type RunActorArgument = ReturnType<typeof runActorFromRequest>;

async function scheduleRun(params: {
  app: SuiteApi;
  input: z.infer<typeof suiteAliasIdParamsSchema> & z.infer<typeof runSuiteInputSchema>;
  projectId: string;
  idempotencyKey: string;
  actor: RunActorArgument;
}): Promise<z.infer<typeof suiteRunResultSchema>> {
  const { app, input, projectId, idempotencyKey, actor } = params;
  const found = await app.getByIdOrTestSuite({ id: input.suiteId, projectId });
  if (found.kind !== "test_suite" && input.targets !== undefined) {
    throw storedTargetsRefusal("run");
  }

  const result =
    found.kind === "test_suite"
      ? await app.runPlan({
          projectId,
          config: {
            scope: { mode: "test_suites", testSuiteIds: [input.suiteId] },
            targets: input.targets ?? [],
          },
          idempotencyKey,
          ...(input.parameters !== undefined && { parameters: input.parameters }),
          ...(input.note !== undefined && { note: input.note }),
          ...(actor !== undefined && { actor }),
        })
      : await app.run({
          id: input.suiteId,
          projectId,
          idempotencyKey,
          parameters: input.parameters,
          note: input.note,
          actor,
        });

  // `name` is declared nullable, and the domain leaves it unset rather than
  // null, so the items are mapped rather than spread.
  return { ...result, scheduled: true, items: toRunItemsWire(result.items) };
}

/**
 * The one refusal this family re-words: a rejected execution carries the
 * plan's reasons, published at 400. Everything else — already a handled
 * error with its own cause, 404, and remediation — travels to the boundary untouched.
 */
function refuseRun(error: unknown): never {
  if (error instanceof SuiteExecutionError) throw new SuiteAliasRunRefusedError(error);

  throw error;
}

/**
 * Archiving a test suite archives every scenario filed in it; an id that names
 * no test suite is archived as a run plan instead.
 */
async function archiveSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
}): Promise<z.infer<typeof archivedSuiteSchema>> {
  const { app, id, projectId } = params;
  logger.info({ projectId, suiteId: id }, "Archiving suite");

  const archivedTestSuite = await app
    .archiveTestSuite({ testSuiteId: id, projectId })
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof ScenarioTestSuiteNotFoundError) return false;
      throw error;
    });
  if (archivedTestSuite) return { id, archived: true };

  await app.archive({ id, projectId });

  return { id, archived: true };
}

/**
 * REST for suites — the run plans a project assembles by hand, and the test
 * suites scenarios are filed into.
 */
export function createSuitesAliasRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<SuiteApi>;
}> {
  return (
    defineRestRouter(SuiteApi)
      .withNamespace("suites")
      .withVersion(MANAGEMENT_API_VERSION)
      .withDeprecated(DEPRECATION)

      // ── List Suites ────────────────────────────────────────────
      .get("/", "getApiSuites")
      .withQuery(listSuitesQuerySchema)
      .withPermission("scenarios:view")
      .withOutput(z.array(suiteResponseWithPlatformUrlSchema))
      .withDocs({
        description:
          "List all non-archived suites for the project. By default only custom run plans are returned; pass kind=folder for test suites.",
      })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input: query, scope }, project) =>
        listSuites({
          app,
          kind: query.kind,
          projectId: scope.id,
          projectSlug: project.projectSlug,
        }),
      )

      // ── Get Suite ──────────────────────────────────────────────
      .get("/:suiteId", "getApiSuitesById")
      .withParams(suiteAliasIdParamsSchema)
      .withPermission("scenarios:view")
      .withOutput(suiteResponseWithPlatformUrlSchema)
      .withDocs({
        description: "Get a suite (run plan) by its ID.",
        responses: notFound,
      })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input: params, scope }, project) =>
        getSuite({
          app,
          id: params.suiteId,
          projectId: scope.id,
          projectSlug: project.projectSlug,
        }),
      )

      // ── Create Suite ─────────────────────────────────────────── Creating a run plan asks
      // for `scenarios:create`, not `scenarios:manage`. `:manage` still implies `:create`,
      // so every role and key that could create a suite yesterday still can.
      .post("/", "postApiSuites")
      .withInput(createSuiteInputSchema)
      .withPermission("scenarios:create")
      .withOutput(suiteResponseWithPlatformUrlSchema)
      .withStatus(201)
      .withDocs({ description: "Create a new suite (run plan)." })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input: body, scope }, project) =>
        createSuite({
          app,
          input: body,
          projectId: scope.id,
          projectSlug: project.projectSlug,
        }),
      )

      // ── Update Suite ─────────────────────────────────────────── `:update` for the same
      // reason as `:create` above.
      .patch("/:suiteId", "patchApiSuitesById")
      .withParams(suiteAliasIdParamsSchema)
      .withInput(updateSuiteInputSchema)
      .withPermission("scenarios:update")
      .withOutput(suiteResponseWithPlatformUrlSchema)
      .withDocs({ description: "Update a suite (run plan).", responses: notFound })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input: body, scope }, project) =>
        updateSuite({
          app,
          input: body,
          projectId: scope.id,
          projectSlug: project.projectSlug,
        }),
      )

      // ── Duplicate Suite ──────────────────────────────────────── A duplicate is a create:
      // it leaves the source suite untouched and produces a new one.
      .post("/:suiteId/duplicate", "postApiSuitesByIdDuplicate")
      .withParams(suiteAliasIdParamsSchema)
      .withPermission("scenarios:create")
      .withOutput(suiteResponseWithPlatformUrlSchema)
      .withStatus(201)
      .withDocs({ description: "Duplicate a suite (run plan).", responses: notFound })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input: params, scope }, project) =>
        duplicateSuite({
          app,
          id: params.suiteId,
          projectId: scope.id,
          projectSlug: project.projectSlug,
        }),
      )

      // ── Run Suite ────────────────────────────────────────────── RUNNING A SUITE IS NOT
      // ADMINISTERING IT. The run creates scenario runs; the suite definition, its scenarios
      // and its targets are left exactly as they were.
      .post("/:suiteId/run", "postApiSuitesByIdRun")
      .withParams(suiteAliasIdParamsSchema)
      .withInput(runSuiteInputSchema)
      .withPermission("scenarios:create")
      .withOutput(suiteRunResultSchema)
      .withDocs({
        description:
          "Trigger a suite run. Schedules scenario executions for all active scenarios x targets x repeatCount. When the id names a test suite, the targets are read from the body.",
        responses: notFound,
      })
      .withMiddleware(projectRestFacts, suiteSurfaceFact)
      .handle(({ app, input: body, scope }, project, surface) =>
        runSuite({
          app,
          input: body,
          projectId: scope.id,
          viewerUserId: project.viewerUserId,
          surface,
        }),
      )

      // ── Delete (Archive) Suite ───────────────────────────────── Archiving deliberately
      // stays at `:manage` — it is the only grain that carries destruction.
      .delete("/:suiteId", "deleteApiSuitesById")
      .withParams(suiteAliasIdParamsSchema)
      .withPermission("scenarios:manage")
      .withOutput(archivedSuiteSchema)
      .withDocs({
        description:
          "Archive (soft-delete) a suite. Archiving a test suite also archives every scenario filed in it, in one transaction.",
        responses: notFound,
      })
      .handle(({ app, input: params, scope }) =>
        archiveSuite({ app, id: params.suiteId, projectId: scope.id }),
      )
      .build()
  );
}
