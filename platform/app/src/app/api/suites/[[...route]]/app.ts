/**
 * The suites REST family: a deprecated alias.
 *
 * It predates the split between a RUN PLAN, which is what you run and is
 * identified by its name, and a TEST SUITE, which is a folder of scenarios.
 * Both now have a family of their own, `/api/v1/run-plans` and
 * `/api/v1/test-suites`, and this one keeps answering exactly as it did.
 *
 * Every response carries the deprecation headers and every operation is marked
 * deprecated in the published document, so an integrator reading either finds
 * where the family went.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { deprecatedAlias } from "~/app/api/shared/deprecation";
import { runActorOf } from "~/app/api/shared/run-actor";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { suiteTargetSchema } from "~/app/api/shared/suite-wire";
import type { SimulationSuite } from "~/generated/prisma/client";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { ProjectRepository } from "~/server/projects/project.repository";
import { runParameterValuesSchema } from "~/server/scenarios/parameters";
import { runNoteSchema } from "~/server/scenarios/run-note";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { SuiteDomainError } from "~/server/suites/errors";
import { MAX_PLAN_NAME_LENGTH } from "~/server/suites/plan-name";
import { parseSuiteScope, suiteScopeSchema } from "~/server/suites/scope";
import { SuiteService } from "~/server/suites/suite.service";
import { isSuiteKind } from "~/server/suites/types";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

patchZodOpenapi();

const logger = createLogger("langwatch:api:suites");

/** The one sentence every operation of this family opens with. */
const DEPRECATION_NOTE =
  "Deprecated: use /api/v1/run-plans and /api/v1/test-suites.";

/**
 * The family's refusal body: the flat shape its consumers already parse, plus
 * the domain code when the refusal names one.
 */
const suiteRefusalSchema = badRequestSchema.extend({
  code: z
    .string()
    .optional()
    .describe("The domain error code, when the refusal names one."),
});

/**
 * What a run plan covers. Absent on a plan that runs the list it holds, and on
 * a test suite, whose cases are the ones filed into it.
 */
const scopeSchema = suiteScopeSchema.describe(
  "What the run plan covers: all (every active scenario), folders (the cases filed in the named test suites), labels (the cases carrying any of the labels), or cases (the scenarioIds below). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the plan.",
);

/**
 * The suite as this family answers it. `kind` and `scope` are optional in the
 * document, not in the answer: every server sends both. They arrived after
 * clients were generated from this family, and a client that reads them as
 * required fails against a server that predates them.
 *
 * @see specs/api-reference/legacy-response-fields-optional.feature
 */
const suiteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z
    .enum(["custom", "folder"])
    .optional()
    .describe(
      "custom is a hand-assembled run plan; folder is a test suite that groups scenarios filed into it. Absent on servers that predate test suites.",
    ),
  description: z.string().nullable(),
  scenarioIds: z.array(z.string()),
  scope: scopeSchema.nullable().optional(),
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
 * A folder is created empty by definition, so a scope, a member list and a
 * target list are refused rather than silently dropped.
 */
function refuseFolderExtras(body: CreateSuiteBody, ctx: z.RefinementCtx): void {
  if (body.scope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scope"],
      message:
        "A test suite runs the scenarios filed in it, so it takes no scope",
    });
  }
  if (body.scenarioIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioIds"],
      message:
        "A folder is created empty; file scenarios into it after creating it",
    });
  }
  if (body.targets.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targets"],
      message: "A folder gets its targets when a run is started",
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
    scope: scopeSchema.optional(),
    targets: z.array(suiteTargetSchema).default([]),
    repeatCount: z.number().int().min(1).max(100).default(1),
    labels: z.array(z.string()).default([]),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "folder") {
      refuseFolderExtras(body, ctx);
      return;
    }
    refusePlanGaps(body, ctx);
  });

const listSuitesQuerySchema = z.object({
  kind: z
    .enum(["custom", "folder"])
    .default("custom")
    .describe(
      "Which kind of suite to list. Defaults to custom, so callers that predate folders keep seeing exactly the run plans they always did.",
    ),
});

const updateSuiteInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scope: scopeSchema.optional(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});

/**
 * What a run request carries.
 *
 * The execution settings are read only when the id names a test suite
 * (`kind: "folder"`), which stores none of its own. A run plan already holds
 * its configuration, so sending them against one is refused rather than
 * silently ignored.
 */
const runSuiteInputSchema = z.object({
  idempotencyKey: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .optional()
    .describe(
      "The run plan this run joins or creates. Used only when the id names a test suite; derived from the suite name and the targets when absent.",
    ),
  targets: z
    .array(suiteTargetSchema)
    .optional()
    .describe(
      "The prompts, agents or workflows the run goes against. Used only when the id names a test suite, which stores no target of its own.",
    ),
  repeatCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_REPEAT_COUNT)
    .optional()
    .describe(
      `How many times each scenario and target pairing runs, between 1 and ${MAX_REPEAT_COUNT}. Used only when the id names a test suite.`,
    ),
  simulatorModel: z
    .string()
    .nullish()
    .describe(
      "The model that plays the user for every scenario in the run. Used only when the id names a test suite.",
    ),
  judgeModel: z
    .string()
    .nullish()
    .describe(
      "The model that judges every scenario in the run. Used only when the id names a test suite.",
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

/**
 * The execution settings a run request carried, with the ones it left out
 * absent rather than undefined.
 *
 * A test suite stores none of these and reads them from the request; a run
 * plan stores its own and the service refuses a request that carries any. The
 * difference is the service's to make, so this only forwards what was sent.
 */
function executionOverridesIn(
  body: z.infer<typeof runSuiteInputSchema>,
): Pick<
  z.infer<typeof runSuiteInputSchema>,
  "name" | "targets" | "repeatCount" | "simulatorModel" | "judgeModel"
> {
  return {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.targets !== undefined && { targets: body.targets }),
    ...(body.repeatCount !== undefined && { repeatCount: body.repeatCount }),
    ...(body.simulatorModel !== undefined && {
      simulatorModel: body.simulatorModel,
    }),
    ...(body.judgeModel !== undefined && { judgeModel: body.judgeModel }),
  };
}

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

function toSuiteResponse(suite: SimulationSuite) {
  const targets = Array.isArray(suite.targets)
    ? suite.targets
    : typeof suite.targets === "string"
      ? JSON.parse(suite.targets)
      : [];

  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    kind: isSuiteKind(suite.kind) ? suite.kind : "custom",
    description: suite.description,
    scenarioIds: suite.scenarioIds,
    scope: suite.scope === null ? null : parseSuiteScope(suite.scope),
    targets,
    repeatCount: suite.repeatCount,
    labels: suite.labels,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
  };
}

function createService() {
  return SuiteService.create({
    prisma,
    suiteRunService: getApp().suiteRuns.runs,
  });
}

const secured = createProjectApp({ basePath: "/api/suites" });

// Every response of the family names its successor, refusals included.
secured.use(deprecatedAlias({ successor: "/api/v1/run-plans" }));

// ── List Suites ────────────────────────────────────────────
secured.access(requires("scenarios:view")).get(
  "/",
  describeRoute({
    deprecated: true,
    description: `${DEPRECATION_NOTE} List all non-archived suites for the project. By default only custom run plans are returned; pass kind=folder for test suite folders.`,
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

    const service = createService();
    const suites = await service.getAll({
      projectId: project.id,
      kinds: [kind],
    });

    return c.json(
      suites.map((s) => ({
        ...toSuiteResponse(s),
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
    deprecated: true,
    description: `${DEPRECATION_NOTE} Get a suite (run plan) by its ID.`,
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
          "application/json": { schema: resolver(suiteRefusalSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info({ projectId: project.id, suiteId: id }, "Getting suite");

    const service = createService();
    const suite = await service.getById({ id, projectId: project.id });

    if (!suite) {
      return c.json({ error: "Suite not found" }, 404);
    }

    return c.json({
      ...toSuiteResponse(suite),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/simulations/run-plans/${suite.slug}`,
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
    deprecated: true,
    description: `${DEPRECATION_NOTE} Create a new suite (run plan).`,
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

    const service = createService();
    try {
      const suite =
        body.kind === "folder"
          ? await service.createFolder({
              projectId: project.id,
              name: body.name,
            })
          : await service.create({
              name: body.name,
              description: body.description,
              scenarioIds: body.scenarioIds,
              ...(body.scope && { scope: body.scope }),
              targets: body.targets,
              repeatCount: body.repeatCount,
              labels: body.labels,
              projectId: project.id,
            });
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
      if (error instanceof SuiteDomainError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      throw error;
    }
  },
);

// ── Update Suite ───────────────────────────────────────────
// `:update` for the same reason as `:create` above.
secured.access(requires("scenarios:update")).patch(
  "/:id",
  describeRoute({
    deprecated: true,
    description: `${DEPRECATION_NOTE} Update a suite (run plan).`,
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
          "application/json": { schema: resolver(suiteRefusalSchema) },
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

    const service = createService();
    try {
      const suite = await service.update({
        id,
        projectId: project.id,
        data: body,
      });
      return c.json({
        ...toSuiteResponse(suite),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/simulations/run-plans/${suite.slug}`,
        }),
      });
    } catch (error) {
      if (error instanceof SuiteDomainError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      throw error;
    }
  },
);

// ── Duplicate Suite ────────────────────────────────────────
// A duplicate is a create: it leaves the source suite untouched and produces a
// new one, so it asks for `scenarios:create`.
secured.access(requires("scenarios:create")).post(
  "/:id/duplicate",
  describeRoute({
    deprecated: true,
    description: `${DEPRECATION_NOTE} Duplicate a suite (run plan).`,
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
          "application/json": { schema: resolver(suiteRefusalSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info({ projectId: project.id, suiteId: id }, "Duplicating suite");

    const service = createService();
    try {
      const suite = await service.duplicate({ id, projectId: project.id });
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
      if (error instanceof SuiteDomainError) {
        return c.json({ error: error.message, code: error.code }, 404);
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
    deprecated: true,
    description: `${DEPRECATION_NOTE} Trigger a suite run. Schedules scenario executions for all active scenarios x targets x repeatCount. When the id names a test suite, the targets, the repeat count and the models are read from the body.`,
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
          "application/json": { schema: resolver(suiteRefusalSchema) },
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

    const service = createService();
    const suite = await service.getById({ id, projectId: project.id });

    if (!suite) {
      return c.json({ error: "Suite not found" }, 404);
    }

    const projectRepository = new ProjectRepository(prisma);
    const organizationId = await projectRepository.getOrganizationId({
      projectId: project.id,
    });
    if (!organizationId) {
      return c.json({ error: "Organization not found for project" }, 404);
    }

    try {
      const idempotencyKey = body.idempotencyKey ?? `api-${randomUUID()}`;
      const result = await service.run({
        suite,
        projectId: project.id,
        organizationId,
        idempotencyKey,
        parameters: body.parameters,
        note: body.note,
        // Read by a test suite run, which stores none of these; a run plan run
        // that carries any of them is refused by the service.
        ...executionOverridesIn(body),
        // A user-bound key names the person it belongs to. A project key
        // names nobody, and the run records no actor at all.
        actor: runActorOf(c),
      });

      return c.json({
        scheduled: true,
        ...result,
      });
    } catch (error) {
      if (error instanceof SuiteDomainError) {
        return c.json({ error: error.message, code: error.code }, 400);
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
    deprecated: true,
    description: `${DEPRECATION_NOTE} Archive (soft-delete) a suite. Archiving a folder also archives every scenario filed in it, in one transaction.`,
    responses: {
      ...baseResponses,
      200: {
        description: "Suite archived",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ id: z.string(), archived: z.boolean() }),
            ),
          },
        },
      },
      404: {
        description: "Suite not found",
        content: {
          "application/json": { schema: resolver(suiteRefusalSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info({ projectId: project.id, suiteId: id }, "Archiving suite");

    const service = createService();
    const existing = await service.getById({ id, projectId: project.id });

    if (!existing) {
      return c.json({ error: "Suite not found" }, 404);
    }

    // A folder holds the cases filed into it, so archiving it archives them
    // too. A run plan only references cases and leaves them where they are.
    if (existing.kind === "folder") {
      await service.archiveFolder({ projectId: project.id, folderId: id });
      return c.json({ id, archived: true });
    }

    const result = await service.archive({ id, projectId: project.id });

    if (!result) {
      return c.json({ error: "Suite not found" }, 404);
    }

    return c.json({ id, archived: true });
  },
);

export const app = secured.hono;
