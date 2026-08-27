import { createLogger } from "@langwatch/observability";
import {
  type Suite,
  SuiteExecutionError,
  SuiteNotFoundError,
  suiteTargetSchema,
} from "@langwatch/suite-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { runParameterValuesSchema } from "@langwatch/scenario-contract";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

patchZodOpenapi();

const logger = createLogger("langwatch:api:suites");

const suiteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const suiteResponseWithPlatformUrlSchema = suiteResponseSchema.extend({
  platformUrl: z.string().url(),
});

const createSuiteInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  scenarioIds: z.array(z.string()).min(1, "At least one scenario is required"),
  targets: z.array(suiteTargetSchema).min(1, "At least one target is required"),
  repeatCount: z.number().int().min(1).max(100).default(1),
  labels: z.array(z.string()).default([]),
});

const updateSuiteInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
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
    description: suite.description,
    scenarioIds: suite.scenarioIds,
    targets: suite.targets,
    repeatCount: suite.repeatCount,
    labels: suite.labels,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
  };
}

const secured = createProjectApp({ basePath: "/api/suites" });

// ── List Suites ────────────────────────────────────────────
secured.access(requires("scenarios:view")).get(
  "/",
  describeRoute({
    description: "List all non-archived suites (run plans) for the project",
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
  async (c) => {
    const project = c.get("project");
    logger.info({ projectId: project.id }, "Listing suites");

    const suites = await c.app.suites.list({ projectId: project.id });

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

    let suite: Suite;
    try {
      suite = await c.app.suites.get({ id, projectId: project.id });
    } catch (error) {
      if (!(error instanceof SuiteNotFoundError)) throw error;
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
    logger.info({ projectId: project.id }, "Creating suite");

    const suite = await c.app.suites.create({
      ...body,
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

    let suite: Suite;
    try {
      suite = await c.app.suites.update({
        id,
        projectId: project.id,
        ...body,
      });
    } catch (error) {
      if (!(error instanceof SuiteNotFoundError)) throw error;
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
      const suite = await c.app.suites.duplicate({ id, projectId: project.id });
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

    const projectWithTeam = await c.app.projects.tryGetWithTeam(project.id);
    if (!projectWithTeam) {
      return c.json({ error: "Organization not found for project" }, 404);
    }

    try {
      const idempotencyKey =
        body.idempotencyKey ?? `api-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await c.app.suites.run({
        id,
        projectId: project.id,
        organizationId: projectWithTeam.team.organizationId,
        idempotencyKey,
        parameters: body.parameters,
      });

      return c.json({
        scheduled: true,
        ...result,
      });
    } catch (error) {
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
    description: "Archive (soft-delete) a suite (run plan)",
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
      await c.app.suites.archive({ id, projectId: project.id });
    } catch (error) {
      if (!(error instanceof SuiteNotFoundError)) throw error;
      return c.json({ error: "Suite not found" }, 404);
    }

    return c.json({ id, archived: true });
  },
);

export const app = secured.hono;
