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
  type Suite,
  SuiteExecutionError,
  type SuiteKind,
  SuiteNotFoundError,
  type SuiteScope,
  suiteTargetSchema,
} from "@langwatch/suite-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { OrganizationNotFoundForProjectError, type SuiteApp } from "#app/suite.app";

const logger = createLogger("langwatch:api:suites");

/**
 * What a run plan covers, in the words this family was published with.
 *
 * The domain calls these modes `test_suites` and `scenarios`. This family was
 * published with `folders` and `cases`, so it answers and accepts those and
 * maps at the boundary through {@link toDomainScope} and {@link toWireScope}.
 * An integrator sees no change.
 */
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

/**
 * A run plan states what it runs and what it runs against.
 *
 * A plan that covers a rule resolves its own list at run time, so only a plan
 * that runs a hand-picked list has to name one here.
 */
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
});

function toSuiteResponse(suite: Suite) {
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

function toTestSuiteResponse(testSuite: ScenarioTestSuite) {
  const targets = z.array(suiteTargetSchema).parse(testSuite.targets);

  return {
    id: testSuite.id,
    name: testSuite.name,
    slug: testSuite.slug,
    kind: "folder" as const,
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

/**
 * REST for suites — the run plans a project assembles by hand, and the test
 * suites scenarios are filed into. One family serves both kinds: `kind`
 * on the request picks which, and a lookup by id tries a suite first and falls
 * back to a test suite, exactly as it did in the application.
 *
 * The application arrives as a per-request provider rather than off the Hono
 * context, so the family can be mounted into any process that has one and
 * built with none by the OpenAPI generator. It is the SAME {@link SuiteApp}
 * the tRPC surface is given, so the suite-or-test-suite fallback, the test suite
 * update rules and the project's organization are decided once rather than
 * once per door.
 */
export function createSuiteRestApp(options: {
  security: AppRestSecurity;
  suites: () => SuiteApp;
  platformUrl: PlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, suites, platformUrl } = options;

  const secured = security.createProjectApp({ basePath: "/api/suites" });

  // ── List Suites ────────────────────────────────────────────
  secured.access(requires("scenarios:view")).get(
    "/",
    describeRoute({
      description:
        "List all non-archived suites for the project. By default only custom run plans are returned; pass kind=folder for test suites.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(suiteResponseWithPlatformUrlSchema)),
            },
          },
        },
      },
    }),
    zValidator("query", listSuitesQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { kind } = c.req.valid("query");
      logger.info({ projectId: project.id, kind }, "Listing suites");

      const listed =
        kind === "folder"
          ? (await suites().listTestSuites({ projectId: project.id })).map(toTestSuiteResponse)
          : (await suites().list({ projectId: project.id })).map(toSuiteResponse);

      return c.json(
        listed.map((s) => ({
          ...s,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/simulations/run-plans/${s.slug}`,
          }),
        })),
      );
    },
  );

  // ── Get Suite ──────────────────────────────────────────────
  secured.access(requires("scenarios:view")).get(
    "/:id",
    describeRoute({
      description: "Get a suite (run plan) by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(suiteResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, suiteId: id }, "Getting suite");

      // The "try the run plan, fall back to the test suite" order is the
      // application's; this door only decides how it words the miss.
      let found;
      try {
        found = await suites().getByIdOrTestSuite({ id, projectId: project.id });
      } catch (error) {
        if (!(error instanceof SuiteNotFoundError)) throw error;
        return c.json({ error: "Suite not found" }, 404);
      }

      const body =
        found.kind === "test_suite"
          ? toTestSuiteResponse(found.testSuite)
          : toSuiteResponse(found.suite);

      return c.json({
        ...body,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/simulations/run-plans/${body.slug}`,
        }),
      });
    },
  );

  // ── Create Suite ───────────────────────────────────────────
  // Creating a run plan asks for `scenarios:create`, not `scenarios:manage`.
  // `:manage` still implies `:create` through the RBAC hierarchy, so every role
  // and key that could create a suite yesterday still can; what changes is that a
  // credential issued at the CREATE grain — which the product does issue — is now
  // honoured instead of refused at the door. A viewer holds only `scenarios:view`
  // and is declined exactly as before.
  secured.access(requires("scenarios:create")).post(
    "/",
    describeRoute({
      description: "Create a new suite (run plan)",
      responses: {
        ...baseResponses,
        201: {
          description: "Suite created",
          content: {
            "application/json": {
              schema: resolver(suiteResponseWithPlatformUrlSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createSuiteInputSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, kind: body.kind }, "Creating suite");

      const { kind, scope, ...definition } = body;
      const suite =
        kind === "folder"
          ? toTestSuiteResponse(
              await suites().createTestSuite({
                projectId: project.id,
                name: definition.name,
              }),
            )
          : toSuiteResponse(
              await suites().create({
                ...definition,
                ...(scope ? { scope: toDomainScope(scope) } : {}),
                projectId: project.id,
              }),
            );
      return c.json(
        {
          ...suite,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/simulations/run-plans/${suite.slug}`,
          }),
        },
        201,
      );
    },
  );

  // ── Update Suite ───────────────────────────────────────────
  // `:update` for the same reason as `:create` above.
  secured.access(requires("scenarios:update")).patch(
    "/:id",
    describeRoute({
      description: "Update a suite (run plan)",
      responses: {
        ...baseResponses,
        200: {
          description: "Suite updated",
          content: {
            "application/json": {
              schema: resolver(suiteResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateSuiteInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, suiteId: id }, "Updating suite");

      // Whether this id names a test suite, and what a test suite refuses, is the
      // application's decision — the same one the tRPC surface makes.
      let updated;
      try {
        const { scope, ...fields } = body;
        updated = await suites().update({
          id,
          projectId: project.id,
          ...fields,
          ...(scope ? { scope: toDomainScope(scope) } : {}),
        });
      } catch (error) {
        if (!(error instanceof SuiteNotFoundError)) throw error;
        return c.json({ error: "Suite not found" }, 404);
      }

      const response =
        updated.kind === "test_suite"
          ? toTestSuiteResponse(updated.testSuite)
          : toSuiteResponse(updated.suite);

      return c.json({
        ...response,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/simulations/run-plans/${response.slug}`,
        }),
      });
    },
  );

  // ── Duplicate Suite ────────────────────────────────────────
  // A duplicate is a create: it leaves the source suite untouched and produces a
  // new one, so it asks for `scenarios:create`.
  secured.access(requires("scenarios:create")).post(
    "/:id/duplicate",
    describeRoute({
      description: "Duplicate a suite (run plan)",
      responses: {
        ...baseResponses,
        201: {
          description: "Suite duplicated",
          content: {
            "application/json": {
              schema: resolver(suiteResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, suiteId: id }, "Duplicating suite");

      try {
        const suite = await suites().duplicate({ id, projectId: project.id });
        return c.json(
          {
            ...toSuiteResponse(suite),
            platformUrl: platformUrl({
              projectSlug: project.slug,
              path: `/simulations/run-plans/${suite.slug}`,
            }),
          },
          201,
        );
      } catch (error) {
        if (error instanceof SuiteNotFoundError) {
          return c.json({ error: error.message }, 404);
        }
        throw error;
      }
    },
  );

  // ── Run Suite ──────────────────────────────────────────────
  // RUNNING A SUITE IS NOT ADMINISTERING IT. The run creates scenario runs; the
  // suite definition, its scenarios and its targets are left exactly as they
  // were. `scenarios:manage` is the grain that also carries delete, so gating a
  // run on it meant "you may only execute this if you may also destroy it" — and
  // it refused every credential the product issues at the write grain. A run
  // creates a run, so it asks for `scenarios:create`. `:manage` still implies it,
  // so nobody who could run a suite yesterday loses that today, and a viewer is
  // declined as before.
  secured.access(requires("scenarios:create")).post(
    "/:id/run",
    describeRoute({
      description:
        "Trigger a suite run. Schedules scenario executions for all active scenarios × targets × repeatCount.",
      responses: {
        ...baseResponses,
        200: {
          description: "Suite run scheduled",
          content: {
            "application/json": {
              schema: resolver(suiteRunResultSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", runSuiteInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, suiteId: id }, "Running suite");

      try {
        const idempotencyKey =
          body.idempotencyKey ?? `api-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // The project's organization is the application's to resolve; it
        // refuses when there is none, exactly as this handler used to.
        const result = await suites().run({
          id,
          projectId: project.id,
          idempotencyKey,
          parameters: body.parameters,
          note: body.note,
          // A project key belongs to no person, so it records no actor. A
          // user-bound key records the person it belongs to, through the
          // surface the request declared.
          actor: runActorFromRequest({
            userId: c.get("apiKeyUserId"),
            surfaceHeader: c.req.header("X-LangWatch-Surface"),
          }),
        });

        return c.json({
          scheduled: true,
          ...result,
        });
      } catch (error) {
        if (error instanceof OrganizationNotFoundForProjectError) {
          return c.json({ error: "Organization not found for project" }, 404);
        }
        if (error instanceof SuiteNotFoundError) {
          return c.json({ error: error.message }, 404);
        }
        if (error instanceof SuiteExecutionError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  );

  // ── Delete (Archive) Suite ─────────────────────────────────
  // Archiving deliberately stays at `:manage` — it is the only grain that carries
  // destruction, and a credential scoped to read-and-write must not inherit it.
  secured.access(requires("scenarios:manage")).delete(
    "/:id",
    describeRoute({
      description:
        "Archive (soft-delete) a suite. Archiving a test suite also archives every scenario filed in it, in one transaction.",
      responses: {
        ...baseResponses,
        200: {
          description: "Suite archived",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), archived: z.boolean() })),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, suiteId: id }, "Archiving suite");

      try {
        await suites().archiveTestSuite({
          testSuiteId: id,
          projectId: project.id,
        });
        return c.json({ id, archived: true });
      } catch (error) {
        if (!(error instanceof ScenarioTestSuiteNotFoundError)) throw error;
      }

      try {
        await suites().archive({ id, projectId: project.id });
      } catch (error) {
        if (!(error instanceof SuiteNotFoundError)) throw error;
        return c.json({ error: "Suite not found" }, 404);
      }

      return c.json({ id, archived: true });
    },
  );

  return secured;
}
