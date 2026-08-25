import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod/v4";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { monitorMappingsSchema } from "~/server/tracer/tracesMapping";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { badRequestSchema } from "../../shared/schemas";

patchZodOpenapi();

const logger = createLogger("langwatch:api:monitors");

const executionModeEnum = z.enum(["ON_MESSAGE", "AS_GUARDRAIL", "MANUALLY"]);

const monitorResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  checkType: z.string(),
  enabled: z.boolean(),
  executionMode: executionModeEnum,
  sample: z.number(),
  level: z.string(),
  evaluatorId: z.string().nullable(),
  preconditions: z.unknown(),
  parameters: z.unknown(),
  mappings: z.unknown().nullable(),
  threadIdleTimeout: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const monitorResponseWithPlatformUrlSchema = monitorResponseSchema.extend({
  platformUrl: z.string().url(),
});

const createMonitorSchema = z.object({
  name: z.string().min(1, "name is required"),
  checkType: z.string().min(1, "checkType is required"),
  executionMode: executionModeEnum.default("ON_MESSAGE"),
  preconditions: z
    .array(
      z.object({
        field: z.string().min(1),
        rule: z.string().min(1),
        value: z.string().min(1),
        key: z.string().optional(),
        subkey: z.string().optional(),
      }),
    )
    .default([]),
  parameters: z.record(z.string(), z.json()).default({}),
  mappings: monitorMappingsSchema,
  sample: z.number().min(0).max(1).default(1.0),
  evaluatorId: z.string().min(1).optional(),
  level: z.enum(["trace", "thread"]).default("trace"),
  threadIdleTimeout: z.number().int().positive().nullable().optional(),
});

const updateMonitorSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  checkType: z.string().optional(),
  executionMode: executionModeEnum.optional(),
  preconditions: z
    .array(
      z.object({
        field: z.string().min(1),
        rule: z.string().min(1),
        value: z.string().min(1),
        key: z.string().optional(),
        subkey: z.string().optional(),
      }),
    )
    .optional(),
  parameters: z.record(z.string(), z.json()).optional(),
  mappings: monitorMappingsSchema,
  sample: z.number().min(0).max(1).optional(),
  evaluatorId: z.string().min(1).nullable().optional(),
  level: z.enum(["trace", "thread"]).optional(),
  threadIdleTimeout: z.number().int().positive().nullable().optional(),
});

function toMonitorResponse(monitor: {
  id: string;
  name: string;
  slug: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  sample: number;
  level: string;
  evaluatorId: string | null;
  preconditions: unknown;
  parameters: unknown;
  mappings: unknown;
  threadIdleTimeout: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: monitor.id,
    name: monitor.name,
    slug: monitor.slug,
    checkType: monitor.checkType,
    enabled: monitor.enabled,
    executionMode: monitor.executionMode,
    sample: monitor.sample,
    level: monitor.level,
    evaluatorId: monitor.evaluatorId,
    preconditions: monitor.preconditions,
    parameters: monitor.parameters,
    mappings: monitor.mappings,
    threadIdleTimeout: monitor.threadIdleTimeout,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
  };
}

const secured = createProjectApp({ basePath: "/api/monitors" });

// ── List Monitors ───────────────────────────────────────────
secured.access(requires("evaluations:view")).get(
  "/",
  describeRoute({
    description: "List all online evaluation monitors for the project",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(monitorResponseWithPlatformUrlSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    logger.info({ projectId: project.id }, "Listing monitors");

    const monitors = await c.app.monitors.getAllForProject({
      projectId: project.id,
    });

    return c.json(
      monitors.map((m) => ({
        ...toMonitorResponse(m),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${m.id}`,
        }),
      })),
    );
  },
);

// ── Get Monitor ─────────────────────────────────────────────
secured.access(requires("evaluations:view")).get(
  "/:id",
  describeRoute({
    description: "Get a monitor by its ID",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(monitorResponseWithPlatformUrlSchema),
          },
        },
      },
      404: {
        description: "Monitor not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info({ projectId: project.id, monitorId: id }, "Getting monitor");

    const monitor = await c.app.monitors.tryGetMonitorById({
      id,
      projectId: project.id,
    });

    if (!monitor) {
      return c.json({ error: "Monitor not found" }, 404);
    }

    return c.json({
      ...toMonitorResponse(monitor),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
      }),
    });
  },
);

// ── Create Monitor ──────────────────────────────────────────
// `:create`, matching the tRPC twin at `server/api/routers/monitors.ts` that the
// UI's own "create monitor" button calls. That path already writes `enabled:
// true` with the caller's `executionMode` while asking only for `:create`, so
// demanding `:manage` here made the identical action cost more over REST than it
// does in the product — it did not hold a line, it just picked off the callers
// holding a least-privilege key. `:manage` still satisfies this via the rbac
// hierarchy (`hasPermissionWithHierarchy`), so no existing caller loses access.
// Deletion stays on `:manage` below, which is where the destructive line sits.
secured.access(requires("evaluations:create")).post(
  "/",
  describeRoute({
    description: "Create a new online evaluation monitor",
    responses: {
      ...baseResponses,
      201: {
        description: "Monitor created",
        content: {
          "application/json": {
            schema: resolver(monitorResponseWithPlatformUrlSchema),
          },
        },
      },
    },
  }),
  zValidator("json", createMonitorSchema),
  async (c) => {
    const project = c.get("project");
    const body = c.req.valid("json");
    logger.info({ projectId: project.id }, "Creating monitor");

    const monitor = await c.app.monitors.create({
      projectId: project.id,
      name: body.name,
      checkType: body.checkType,
      executionMode: body.executionMode,
      preconditions: body.preconditions,
      parameters: body.parameters,
      mappings: body.mappings,
      sample: body.sample,
      evaluatorId: body.evaluatorId,
      level: body.level,
      threadIdleTimeout: body.threadIdleTimeout,
    });

    return c.json(
      {
        ...toMonitorResponse(monitor),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
        }),
      },
      201,
    );
  },
);

// ── Update Monitor ──────────────────────────────────────────
secured.access(requires("evaluations:update")).patch(
  "/:id",
  describeRoute({
    description: "Update a monitor (name, enabled state, settings, etc.)",
    responses: {
      ...baseResponses,
      200: {
        description: "Monitor updated",
        content: {
          "application/json": {
            schema: resolver(monitorResponseWithPlatformUrlSchema),
          },
        },
      },
      404: {
        description: "Monitor not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", updateMonitorSchema),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    const body = c.req.valid("json");
    logger.info({ projectId: project.id, monitorId: id }, "Updating monitor");

    const existing = await c.app.monitors.tryGetMonitorById({
      id,
      projectId: project.id,
    });

    if (!existing) {
      return c.json({ error: "Monitor not found" }, 404);
    }

    const monitor = await c.app.monitors.update({
      id,
      projectId: project.id,
      name: body.name ?? existing.name,
      checkType: body.checkType ?? existing.checkType,
      executionMode: body.executionMode ?? existing.executionMode,
      preconditions: body.preconditions ?? existing.preconditions,
      parameters: body.parameters ?? existing.parameters,
      mappings: body.mappings !== undefined ? body.mappings : existing.mappings,
      sample: body.sample ?? existing.sample,
      enabled: body.enabled,
      evaluatorId: body.evaluatorId,
      level: body.level ?? (existing.level as "trace" | "thread"),
      threadIdleTimeout:
        body.threadIdleTimeout !== undefined
          ? body.threadIdleTimeout
          : existing.threadIdleTimeout,
    });

    return c.json({
      ...toMonitorResponse(monitor),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
      }),
    });
  },
);

// ── Toggle Monitor ──────────────────────────────────────────
// Enabling/disabling changes the monitor that already exists — an `:update`.
secured.access(requires("evaluations:update")).post(
  "/:id/toggle",
  describeRoute({
    description: "Enable or disable a monitor",
    responses: {
      ...baseResponses,
      200: {
        description: "Monitor toggled",
        content: {
          "application/json": {
            schema: resolver(z.object({ id: z.string(), enabled: z.boolean() })),
          },
        },
      },
      404: {
        description: "Monitor not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", z.object({ enabled: z.boolean() })),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    const { enabled } = c.req.valid("json");
    logger.info({ projectId: project.id, monitorId: id, enabled }, "Toggling monitor");

    const existing = await c.app.monitors.tryGetMonitorById({
      id,
      projectId: project.id,
    });

    if (!existing) {
      return c.json({ error: "Monitor not found" }, 404);
    }

    await c.app.monitors.toggle({
      id,
      projectId: project.id,
      enabled,
    });

    return c.json({ id, enabled });
  },
);

// ── Delete Monitor ──────────────────────────────────────────
// Destruction deliberately stays at `:manage`.
secured.access(requires("evaluations:manage")).delete(
  "/:id",
  describeRoute({
    description: "Delete a monitor",
    responses: {
      ...baseResponses,
      200: {
        description: "Monitor deleted",
        content: {
          "application/json": {
            schema: resolver(z.object({ id: z.string(), deleted: z.boolean() })),
          },
        },
      },
      404: {
        description: "Monitor not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info({ projectId: project.id, monitorId: id }, "Deleting monitor");

    const existing = await c.app.monitors.tryGetMonitorById({
      id,
      projectId: project.id,
    });

    if (!existing) {
      return c.json({ error: "Monitor not found" }, 404);
    }

    await c.app.monitors.delete({
      id,
      projectId: project.id,
    });

    return c.json({ id, deleted: true });
  },
);

export const app = secured.hono;
