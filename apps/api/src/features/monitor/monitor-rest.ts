import { monitorSettingsSchema, type MonitorService } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  patchZodOpenapi,
  type PlatformUrlBuilder,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";

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

const preconditionsSchema = z.array(
  z.object({
    field: z.string().min(1),
    rule: z.string().min(1),
    value: z.string().min(1),
    key: z.string().optional(),
    subkey: z.string().optional(),
  }),
);

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

/**
 * REST for the project's online-evaluation monitors, `/api/monitors`.
 *
 * `mappingsSchema` is injected rather than defined here: which trace sources
 * a mapping may name is the trace vertical's vocabulary, derived from the
 * mapper table it owns, and a second spelling of that enum in this package
 * would loosen or drift from the one the application enforces. It reaches the
 * routes as a schema so both the request validator and the published document
 * are built from the one definition.
 */
export function createMonitorRestApp(options: {
  security: AppRestSecurity;
  monitors: () => MonitorService;
  platformUrl: PlatformUrlBuilder;
  mappingsSchema: z.ZodType;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, monitors, platformUrl, mappingsSchema } = options;

  const createMonitorSchema = z.object({
    name: z.string().min(1, "name is required"),
    checkType: z.string().min(1, "checkType is required"),
    executionMode: executionModeEnum.default("ON_MESSAGE"),
    preconditions: preconditionsSchema.default([]),
    parameters: z.record(z.string(), z.json()).default({}),
    mappings: mappingsSchema,
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
    preconditions: preconditionsSchema.optional(),
    parameters: z.record(z.string(), z.json()).optional(),
    mappings: mappingsSchema,
    sample: z.number().min(0).max(1).optional(),
    evaluatorId: z.string().min(1).nullable().optional(),
    level: z.enum(["trace", "thread"]).optional(),
    threadIdleTimeout: z.number().int().positive().nullable().optional(),
  });

  const secured = security.createProjectApp({ basePath: "/api/monitors" });

  const monitorDrawerPath = (monitorId: string) =>
    `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitorId}`;

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

      const list = await monitors().getAllForProject({
        projectId: project.id,
      });

      return c.json(
        list.map((m) => ({
          ...toMonitorResponse(m),
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: monitorDrawerPath(m.id),
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

      const monitor = await monitors().tryGetMonitorById({
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
          path: monitorDrawerPath(monitor.id),
        }),
      });
    },
  );

  // ── Create Monitor ──────────────────────────────────────────
  // `:create`, matching the tRPC twin in `@langwatch/monitor-server` that the
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

      const monitor = await monitors().create({
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
            path: monitorDrawerPath(monitor.id),
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

      const service = monitors();
      const existing = await service.tryGetMonitorById({
        id,
        projectId: project.id,
      });

      if (!existing) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      const existingParameters = monitorSettingsSchema.safeParse(existing.parameters);

      const monitor = await service.update({
        id,
        projectId: project.id,
        name: body.name ?? existing.name,
        checkType: body.checkType ?? existing.checkType,
        executionMode: body.executionMode ?? existing.executionMode,
        preconditions: body.preconditions ?? existing.preconditions,
        parameters: body.parameters ?? (existingParameters.success ? existingParameters.data : {}),
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
          path: monitorDrawerPath(monitor.id),
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

      const service = monitors();
      const existing = await service.tryGetMonitorById({
        id,
        projectId: project.id,
      });

      if (!existing) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      await service.toggle({
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

      const service = monitors();
      const existing = await service.tryGetMonitorById({
        id,
        projectId: project.id,
      });

      if (!existing) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      await service.delete({
        id,
        projectId: project.id,
      });

      return c.json({ id, deleted: true });
    },
  );

  return secured;
}
