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
  type PlatformUrlBuilder,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  ScenarioTestSuiteNotFoundError,
  type ScenarioTestSuite,
  runActorFromRequest,
  runNoteSchema,
  runParameterValuesSchema,
} from "@langwatch/scenario-contract";
import {
  isSuiteKind,
  SuiteApi,
  SuiteExecutionError,
  SuiteNotFoundError,
  suiteTargetSchema,
  type Suite,
  type SuiteKind,
  type SuiteScope,
} from "@langwatch/suite-contract";
import { z } from "zod";

import { OrganizationNotFoundForProjectError } from "../app/suite.app.ts";
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

/**
 * A row this family could not address, carrying the sentence it answers with.
 * The body has always been the bare `{ error }` the family writes itself, and
 * the wording differs by route, so the message travels with the refusal.
 */
class SuiteAliasNotFoundError extends Error {}

/** The family's 404s, in the bare `{ error }` body they have always had. */
export const suitesAliasErrorHandler =
  (boundary: RestErrorHandler): RestErrorHandler =>
  (error, c) => {
    if (error instanceof SuiteAliasNotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    return boundary(error, c);
  };

/** The refusal for a body that names targets the addressed row does not take. */
function storedTargetsRefusal(operation: "run" | "update"): ValidationError {
  const message =
    operation === "run"
      ? "A run plan runs the targets it stores; send targets only when the id names a test suite"
      : "A test suite gets its targets when a run is started, so it stores none";

  return new ValidationError(message, { meta: { fieldErrors: { targets: [message] } } });
}

/** What a run plan covers, in the words this family was published with. */
const wireScopeSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("folders"), folderIds: z.array(z.string()) }),
    z.object({ mode: z.literal("labels"), labels: z.array(z.string()) }),
    z.object({ mode: z.literal("cases") }),
  ])
  .describe(
    "What the run plan covers: all (every active scenario), folders (the scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or cases (the scenarioIds below). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the plan.",
  );

type WireScope = z.infer<typeof wireScopeSchema>;

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

const suiteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z
    .enum(["custom", "folder"])
    .describe(
      "custom is a hand-assembled run plan; folder is a test suite that groups scenarios filed into it.",
    ),
  description: z.string().nullable(),
  scenarioIds: z.array(z.string()),
  scope: wireScopeSchema.nullable(),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const suiteResponseWithPlatformUrlSchema = suiteResponseSchema.extend({
  platformUrl: z.string().url(),
});

/** What a create body carries, before either kind's guards are applied. */
type CreateSuiteBody = {
  kind: "custom" | "folder";
  scope?: { mode: string };
  scenarioIds: string[];
  targets: unknown[];
};

/**
 * A test suite is created empty by definition, so a scope, a member list and a
 * target list are refused rather than silently dropped.
 */
function refuseTestSuiteExtras(body: CreateSuiteBody, ctx: z.RefinementCtx): void {
  if (body.scope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scope"],
      message: "A test suite runs the scenarios filed in it, so it takes no scope",
    });
  }
  if (body.scenarioIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioIds"],
      message: "A test suite is created empty; file scenarios into it after creating it",
    });
  }
  if (body.targets.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targets"],
      message: "A test suite gets its targets when a run is started",
    });
  }
}

/** A run plan states what it runs and what it runs against. */
function refusePlanGaps(body: CreateSuiteBody, ctx: z.RefinementCtx): void {
  const picksCases = !body.scope || body.scope.mode === "cases";
  if (picksCases && body.scenarioIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioIds"],
      message: "At least one scenario is required",
    });
  }
  if (body.targets.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targets"],
      message: "At least one target is required",
    });
  }
}

/**
 * One create schema for both kinds, with the guards conditional on kind: a
 * body naming no kind is a custom run plan and keeps the historical
 * at-least-one guards.
 */
const createSuiteInputSchema = z
  .object({
    name: z.string().min(1, "name is required"),
    kind: z
      .enum(["custom", "folder"])
      .default("custom")
      .describe(
        "custom (the default) is a run plan and needs scenarioIds and targets; folder is a test suite that starts empty and gets scenarios by filing them into it.",
      ),
    description: z.string().optional(),
    scenarioIds: z.array(z.string()).default([]),
    scope: wireScopeSchema.optional(),
    targets: z.array(suiteTargetSchema).default([]),
    repeatCount: z.number().int().min(1).max(100).default(1),
    labels: z.array(z.string()).default([]),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "folder") {
      refuseTestSuiteExtras(body, ctx);

      return;
    }
    refusePlanGaps(body, ctx);
  });

const listSuitesQuerySchema = z.object({
  kind: z
    .enum(["custom", "folder"])
    .default("custom")
    .describe(
      "Which kind of suite to list. Defaults to custom, so callers that predate test suites keep seeing exactly the run plans they always did.",
    ),
});

const updateSuiteInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scope: wireScopeSchema.optional(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});

const runSuiteInputSchema = z.object({
  idempotencyKey: z.string().optional(),
  targets: z
    .array(suiteTargetSchema)
    .optional()
    .describe(
      "The prompts, agents or workflows the run goes against. Read only when the id names a test suite, which stores no target of its own; a run plan already holds its own and refuses these.",
    ),
  parameters: runParameterValuesSchema
    .optional()
    .describe(
      "Constant values applied to every scenario in the run, e.g. a fixture id or a tenant. A value supplied here overrides the scenario's own default for that name.",
    ),
  note: runNoteSchema.describe(
    "One short line describing why this batch was run, e.g. a commit hash or what you changed. It is stored on every run of the batch and shown beside the run in the platform. Up to 200 characters.",
  ),
});

const suiteRunResultSchema = z.object({
  scheduled: z.boolean(),
  batchRunId: z.string(),
  setId: z.string(),
  jobCount: z.number(),
  skippedArchived: z.object({
    scenarios: z.array(z.string()),
    targets: z.array(z.string()),
  }),
  items: z.array(
    z.object({
      scenarioRunId: z.string(),
      scenarioId: z.string(),
      target: suiteTargetSchema,
      name: z.string().nullable(),
    }),
  ),
  // Only a test-suite run files itself under a run plan, so only that half of
  // the alias answers with the plan it reached. Undeclared, the pipeline
  // strips both from the body the caller was answered with on main.
  planName: z.string().optional(),
  created: z.boolean().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const archivedSuiteSchema = z.object({ id: z.string(), archived: z.boolean() });
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
  platformUrl: PlatformUrlBuilder;
}): SuiteResponseWithPlatformUrl {
  return {
    ...params.row,
    platformUrl: params.platformUrl({
      projectSlug: params.projectSlug,
      path: PLAN_PATH(params.row.slug),
    }),
  };
}

/** A missing row, in the sentence this family answers it with. */
function refuseAsMissing(error: unknown, message: string): never {
  if (error instanceof SuiteNotFoundError) throw new SuiteAliasNotFoundError(message);
  throw error;
}

async function listSuites(params: {
  app: SuiteApi;
  kind: "custom" | "folder";
  projectId: string;
  projectSlug: string;
  platformUrl: PlatformUrlBuilder;
}): Promise<SuiteResponseWithPlatformUrl[]> {
  const { app, kind, projectId } = params;
  logger.info({ projectId, kind }, "Listing suites");

  const listed =
    kind === "folder"
      ? (await app.listTestSuites({ projectId })).map(toTestSuiteResponse)
      : (await app.list({ projectId })).map(toSuiteResponse);

  return listed.map((row) =>
    withPlatformUrl({ row, projectSlug: params.projectSlug, platformUrl: params.platformUrl }),
  );
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
  platformUrl: PlatformUrlBuilder;
}): Promise<SuiteResponseWithPlatformUrl> {
  logger.info({ projectId: params.projectId, suiteId: params.id }, "Getting suite");

  // The "try the run plan, fall back to the test suite" order is the
  // application's; this door only decides how it words the miss.
  const found = await params.app
    .getByIdOrTestSuite({ id: params.id, projectId: params.projectId })
    .catch((error: unknown) => refuseAsMissing(error, "Suite not found"));

  return withPlatformUrl({
    row: eitherResponse(found),
    projectSlug: params.projectSlug,
    platformUrl: params.platformUrl,
  });
}

async function createSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof createSuiteInputSchema>;
  projectId: string;
  projectSlug: string;
  platformUrl: PlatformUrlBuilder;
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

  return withPlatformUrl({ row, projectSlug: params.projectSlug, platformUrl: params.platformUrl });
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
  input: z.infer<typeof idParamsSchema> & z.infer<typeof updateSuiteInputSchema>;
  projectId: string;
  projectSlug: string;
  platformUrl: PlatformUrlBuilder;
}): Promise<SuiteResponseWithPlatformUrl> {
  const { app, projectId } = params;
  const { id, scope, ...fields } = params.input;
  logger.info({ projectId, suiteId: id }, "Updating suite");

  // Whether this id names a test suite, and what a test suite refuses, is the
  // application's decision — the same one the tRPC surface makes.
  if (fields.targets !== undefined) await refuseTargetsOnTestSuite({ app, id, projectId });

  const updated = await app
    .update({ id, projectId, ...fields, ...(scope ? { scope: toDomainScope(scope) } : {}) })
    .catch((error: unknown) => refuseAsMissing(error, "Suite not found"));

  return withPlatformUrl({
    row: eitherResponse(updated),
    projectSlug: params.projectSlug,
    platformUrl: params.platformUrl,
  });
}

async function duplicateSuite(params: {
  app: SuiteApi;
  id: string;
  projectId: string;
  projectSlug: string;
  platformUrl: PlatformUrlBuilder;
}): Promise<SuiteResponseWithPlatformUrl> {
  logger.info({ projectId: params.projectId, suiteId: params.id }, "Duplicating suite");

  const suite = await params.app
    .duplicate({ id: params.id, projectId: params.projectId })
    .catch((error: unknown) => refuseAsMissing(error, missingSuiteMessage(error)));

  return withPlatformUrl({
    row: toSuiteResponse(suite),
    projectSlug: params.projectSlug,
    platformUrl: params.platformUrl,
  });
}

/** The domain's own wording for a miss, kept as this family always answered it. */
function missingSuiteMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Suite not found";
}

/**
 * Schedules the run this id names. A test suite stores no target, so the run
 * takes them from the body and is filed under the run plan its scope resolves.
 * A run plan stores its own, so a body naming any is a malformed request.
 */
async function runSuite(params: {
  app: SuiteApi;
  input: z.infer<typeof idParamsSchema> & z.infer<typeof runSuiteInputSchema>;
  projectId: string;
  viewerUserId: string | null;
  surface: string | null;
}): Promise<z.infer<typeof suiteRunResultSchema>> {
  const { app, input, projectId } = params;
  logger.info({ projectId, suiteId: input.id }, "Running suite");

  // A project key belongs to no person, so it records no actor. A user-bound
  // key records the person it belongs to, through the surface the request
  // declared.
  const actor = runActorFromRequest({
    userId: params.viewerUserId,
    surfaceHeader: params.surface,
  });
  const idempotencyKey = input.idempotencyKey ?? `api-${randomUUID()}`;

  return await scheduleRun({ app, input, projectId, idempotencyKey, actor }).catch(
    (error: unknown) => refuseRun(error),
  );
}

type RunActorArgument = ReturnType<typeof runActorFromRequest>;

async function scheduleRun(params: {
  app: SuiteApi;
  input: z.infer<typeof idParamsSchema> & z.infer<typeof runSuiteInputSchema>;
  projectId: string;
  idempotencyKey: string;
  actor: RunActorArgument;
}): Promise<z.infer<typeof suiteRunResultSchema>> {
  const { app, input, projectId, idempotencyKey, actor } = params;
  const found = await app.getByIdOrTestSuite({ id: input.id, projectId });
  if (found.kind !== "test_suite" && input.targets !== undefined) {
    throw storedTargetsRefusal("run");
  }

  const result =
    found.kind === "test_suite"
      ? await app.runPlan({
          projectId,
          config: {
            scope: { mode: "test_suites", testSuiteIds: [input.id] },
            targets: input.targets ?? [],
          },
          idempotencyKey,
          ...(input.parameters !== undefined && { parameters: input.parameters }),
          ...(input.note !== undefined && { note: input.note }),
          ...(actor !== undefined && { actor }),
        })
      : await app.run({
          id: input.id,
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

/** Every refusal this family renders itself, at the status it publishes it. */
function refuseRun(error: unknown): never {
  if (error instanceof OrganizationNotFoundForProjectError) {
    throw new SuiteAliasNotFoundError("Organization not found for project");
  }
  // The domain's own refusal, at the status this family publishes: the code,
  // the fault and the remediation are the boundary's to render.
  if (error instanceof SuiteExecutionError) throw new SuiteAliasRunRefusedError(error);

  return refuseAsMissing(error, missingSuiteMessage(error));
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

  await app
    .archive({ id, projectId })
    .catch((error: unknown) => refuseAsMissing(error, "Suite not found"));

  return { id, archived: true };
}

/**
 * REST for suites — the run plans a project assembles by hand, and the test
 * suites scenarios are filed into.
 */
export function createSuitesAliasRest(platformUrl: PlatformUrlBuilder) {
  return (
    defineRestRouter(SuiteApi)
      .withNamespace("suites")
      .withVersion(MANAGEMENT_API_VERSION)
      .withDeprecated(DEPRECATION)

      // ── List Suites ────────────────────────────────────────────
      .get("/", "listSuites")
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
          platformUrl,
        }),
      )

      // ── Get Suite ──────────────────────────────────────────────
      .get("/:id", "getSuite")
      .withParams(idParamsSchema)
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
          id: params.id,
          projectId: scope.id,
          projectSlug: project.projectSlug,
          platformUrl,
        }),
      )

      // ── Create Suite ─────────────────────────────────────────── Creating a run plan asks
      // for `scenarios:create`, not `scenarios:manage`. `:manage` still implies `:create`,
      // so every role and key that could create a suite yesterday still can.
      .post("/", "createSuite")
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
          platformUrl,
        }),
      )

      // ── Update Suite ─────────────────────────────────────────── `:update` for the same
      // reason as `:create` above.
      .patch("/:id", "updateSuite")
      .withParams(idParamsSchema)
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
          platformUrl,
        }),
      )

      // ── Duplicate Suite ──────────────────────────────────────── A duplicate is a create:
      // it leaves the source suite untouched and produces a new one.
      .post("/:id/duplicate", "duplicateSuite")
      .withParams(idParamsSchema)
      .withPermission("scenarios:create")
      .withOutput(suiteResponseWithPlatformUrlSchema)
      .withStatus(201)
      .withDocs({ description: "Duplicate a suite (run plan).", responses: notFound })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input: params, scope }, project) =>
        duplicateSuite({
          app,
          id: params.id,
          projectId: scope.id,
          projectSlug: project.projectSlug,
          platformUrl,
        }),
      )

      // ── Run Suite ────────────────────────────────────────────── RUNNING A SUITE IS NOT
      // ADMINISTERING IT. The run creates scenario runs; the suite definition, its scenarios
      // and its targets are left exactly as they were.
      .post("/:id/run", "runSuite")
      .withParams(idParamsSchema)
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
      .delete("/:id", "archiveSuite")
      .withParams(idParamsSchema)
      .withPermission("scenarios:manage")
      .withOutput(archivedSuiteSchema)
      .withDocs({
        description:
          "Archive (soft-delete) a suite. Archiving a test suite also archives every scenario filed in it, in one transaction.",
        responses: notFound,
      })
      .handle(({ app, input: params, scope }) =>
        archiveSuite({ app, id: params.id, projectId: scope.id }),
      )
      .build()
  );
}
