import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";
import type { Monitor } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import type { ErrorHandler } from "hono";
import { z } from "zod";
import type { MonitorApp } from "#app/monitor.app";

/**
 * A monitor this project does not hold. The family answers it in the bare
 * `{ error }` body it has always had, so it is raised as the family's own
 * error and rendered by the family's own handler.
 */
class MonitorNotFoundError extends Error {
  constructor() {
    super("Monitor not found");
  }
}

const monitorErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof MonitorNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    return boundary(error, c);
  };

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

function toMonitorResponse(
  monitor: {
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
  } & Pick<Monitor, "createdAt" | "updatedAt">,
) {
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
}): MountableRestApp {
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

  const idParamsSchema = z.object({ id: z.string().min(1) });
  const toggleSchema = z.object({ enabled: z.boolean() });
  const toggledSchema = z.object({ id: z.string(), enabled: z.boolean() });
  const deletedSchema = z.object({ id: z.string(), deleted: z.boolean() });

  const { service, policy } = security.createProjectVersionedApp({
    name: "monitors",
    basePath: "/api/monitors",
    errorEnvelope: "legacy",
    errorHandler: monitorErrorHandler,
  });

  type MonitorContext = ProjectScopedContext<EndpointVariables>;

  const monitorDrawerPath = (monitorId: string) =>
    `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitorId}`;

  const withPlatformUrl = (
    monitor: Parameters<typeof toMonitorResponse>[0],
    projectSlug: string,
  ) => ({
    ...toMonitorResponse(monitor),
    platformUrl: platformUrl({ projectSlug, path: monitorDrawerPath(monitor.id) }),
  });

  const listHandler = async (c: MonitorContext) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id }, "Listing monitors");

    const list = await app().list({ projectId: project.id });
    return list.map((m) => withPlatformUrl(m, project.slug));
  };

  const getHandler = async (c: MonitorContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id, monitorId: input.id }, "Getting monitor");

    const monitor = await app().tryGetById({ id: input.id, projectId: project.id });
    if (!monitor) throw new MonitorNotFoundError();
    return withPlatformUrl(monitor, project.slug);
  };

  const createHandler = async (c: MonitorContext, input: z.infer<typeof createMonitorSchema>) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id }, "Creating monitor");

    const monitor = await app().create({
      projectId: project.id,
      name: input.name,
      checkType: input.checkType,
      executionMode: input.executionMode,
      preconditions: input.preconditions,
      parameters: input.parameters,
      mappings: input.mappings,
      sample: input.sample,
      evaluatorId: input.evaluatorId,
      level: input.level,
      threadIdleTimeout: input.threadIdleTimeout,
    });
    return withPlatformUrl(monitor, project.slug);
  };

  const updateHandler = async (
    c: MonitorContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateMonitorSchema>,
  ) => {
    const project = projectOf(c);
    const { id, ...changes } = input;
    logger.info({ projectId: project.id, monitorId: id }, "Updating monitor");

    // What an unmentioned field means on a partial update is the
    // application's answer, not this family's. It was spelled out here as
    // well, and the two copies had already begun to disagree.
    const monitor = await app().patch({ id, projectId: project.id, changes });
    if (!monitor) throw new MonitorNotFoundError();
    return withPlatformUrl(monitor, project.slug);
  };

  const toggleHandler = async (
    c: MonitorContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof toggleSchema>,
  ) => {
    const project = projectOf(c);
    const { id, enabled } = input;
    logger.info({ projectId: project.id, monitorId: id, enabled }, "Toggling monitor");

    const toggled = await app().toggleExisting({ id, projectId: project.id, enabled });
    if (!toggled) throw new MonitorNotFoundError();
    return { id, enabled };
  };

  const deleteHandler = async (c: MonitorContext, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id, monitorId: input.id }, "Deleting monitor");

    const deleted = await app().deleteExisting({ id: input.id, projectId: project.id });
    if (!deleted) throw new MonitorNotFoundError();
    return { id: input.id, deleted: true };
  };

  const notFoundResponse = {
    404: {
      description: "Monitor not found",
      content: { "application/json": { schema: resolver(badRequestSchema) } },
    },
  };

  return (
    service
      // ── List Monitors ───────────────────────────────────────────
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("evaluations:view"))(b)
          .withOutput(z.array(monitorResponseWithPlatformUrlSchema))
          .withDocs({
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
      )
      // ── Get Monitor ─────────────────────────────────────────────
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("evaluations:view"))(b)
          .withParams(idParamsSchema)
          .withOutput(monitorResponseWithPlatformUrlSchema)
          .withDocs({
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
              ...notFoundResponse,
            },
          }),
      )
      // ── Create Monitor ──────────────────────────────────────────
      // `:create`, matching the tRPC twin in `@langwatch/monitor-server` that
      // the UI's own "create monitor" button calls. `:manage` still satisfies
      // this via the permission hierarchy, so no existing caller loses access.
      // Deletion stays on `:manage` below, where the destructive line sits.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("evaluations:create"))(b)
          .withInput(createMonitorSchema)
          .withOutput(monitorResponseWithPlatformUrlSchema)
          .withStatus(201)
          .withDocs({
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
      )
      // ── Update Monitor ──────────────────────────────────────────
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requires("evaluations:update"))(b)
          .withParams(idParamsSchema)
          .withInput(updateMonitorSchema)
          .withOutput(monitorResponseWithPlatformUrlSchema)
          .withDocs({
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
              ...notFoundResponse,
            },
          }),
      )
      // ── Toggle Monitor ──────────────────────────────────────────
      // Enabling/disabling changes the monitor that already exists — an `:update`.
      .registerRoute("post", "/:id/toggle", MANAGEMENT_API_VERSION, toggleHandler, (b) =>
        policy(requires("evaluations:update"))(b)
          .withParams(idParamsSchema)
          .withInput(toggleSchema)
          .withOutput(toggledSchema)
          .withDocs({
            description: "Enable or disable a monitor",
            responses: {
              ...baseResponses,
              200: {
                description: "Monitor toggled",
                content: { "application/json": { schema: resolver(toggledSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      // ── Delete Monitor ──────────────────────────────────────────
      // Destruction deliberately stays at `:manage`.
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteHandler, (b) =>
        policy(requires("evaluations:manage"))(b)
          .withParams(idParamsSchema)
          .withOutput(deletedSchema)
          .withDocs({
            description: "Delete a monitor",
            responses: {
              ...baseResponses,
              200: {
                description: "Monitor deleted",
                content: { "application/json": { schema: resolver(deletedSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      .build()
  );
}
