import { randomUUID } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import type { SimulationSuite } from "~/generated/prisma/client";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { ProjectRepository } from "~/server/projects/project.repository";
import { runParameterValuesSchema } from "~/server/scenarios/parameters";
import { runNoteSchema } from "~/server/scenarios/run-note";
import { SuiteDomainError } from "~/server/suites/errors";
import { SuiteService } from "~/server/suites/suite.service";
import { isSuiteKind } from "~/server/suites/types";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

patchZodOpenapi();

const logger = createLogger("langwatch:api:suites");

const suiteTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

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
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const suiteResponseWithPlatformUrlSchema = suiteResponseSchema.extend({
  platformUrl: z.string().url(),
});

/**
 * One create schema for both kinds, with the guards conditional on kind: a
 * body naming no kind is a custom run plan and keeps the historical
 * at-least-one guards; a folder is created empty by definition, so member
 * and target lists are refused rather than silently dropped.
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
    targets: z.array(suiteTargetSchema).default([]),
    repeatCount: z.number().int().min(1).max(100).default(1),
    labels: z.array(z.string()).default([]),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "folder") {
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
      return;
    }
    if (body.scenarioIds.length === 0) {
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

// ── List Suites ────────────────────────────────────────────
secured.access(requires("scenarios:view")).get(
  "/",
  describeRoute({
    description:
      "List all non-archived suites for the project. By default only custom run plans are returned; pass kind=folder for test suite folders.",
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
        return c.json({ error: error.message }, 400);
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
        return c.json({ error: error.message }, 400);
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
      });

      return c.json({
        scheduled: true,
        ...result,
      });
    } catch (error) {
      if (error instanceof SuiteDomainError) {
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
      "Archive (soft-delete) a suite. Archiving a folder also archives every test case filed in it, in one transaction.",
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
          "application/json": { schema: resolver(badRequestSchema) },
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
