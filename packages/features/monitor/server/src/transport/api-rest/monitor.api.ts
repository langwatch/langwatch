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
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { MonitorApp } from "#app/monitor.app";

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
 *
 * Every rule about a monitor is {@link MonitorApp}'s — what an unmentioned
 * field on a partial update means, and what a write does to one. This family
 * owns only its own wire shape and its status codes: `null` from the
 * application is 404 here, and the tRPC twin renders the same `null` its own
 * way.
 */
export function createMonitorRestApp(options: {
  security: AppRestSecurity;
  app: () => MonitorApp;
  platformUrl: PlatformUrlBuilder;
  mappingsSchema: z.ZodType;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, app, platformUrl, mappingsSchema } = options;

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

      const list = await app().list({ projectId: project.id });

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

      const monitor = await app().tryGetById({ id, projectId: project.id });

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

      const monitor = await app().create({
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

      // What an unmentioned field means on a partial update is the
      // application's answer, not this family's. It was spelled out here as
      // well, and the two copies had already begun to disagree.
      const monitor = await app().patch({ id, projectId: project.id, changes: body });

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

      const toggled = await app().toggleExisting({ id, projectId: project.id, enabled });

      if (!toggled) {
        return c.json({ error: "Monitor not found" }, 404);
      }

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

      const deleted = await app().deleteExisting({ id, projectId: project.id });

      if (!deleted) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      return c.json({ id, deleted: true });
    },
  );

  return secured;
}
