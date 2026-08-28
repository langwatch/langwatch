import {
  type AutomationService,
  hasActionableTriggerFilters,
  type Trigger,
  TriggerFiltersRequiredError,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { nanoid } from "nanoid";
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

const logger = createLogger("langwatch:api:triggers");

const triggerActionEnum = z.enum([
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
]);

const alertTypeEnum = z.enum(["CRITICAL", "WARNING", "INFO"]);

const triggerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: triggerActionEnum,
  actionParams: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  message: z.string().nullable(),
  alertType: alertTypeEnum.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const triggerResponseWithPlatformUrlSchema = triggerResponseSchema.extend({
  platformUrl: z.string().url(),
});

const createTriggerSchema = z.object({
  name: z.string().min(1, "name is required"),
  action: triggerActionEnum,
  actionParams: z.record(z.string(), z.unknown()).default({}),
  // No default. An omitted condition used to become `{}`, which matches every
  // trace forever, so the easiest possible create call produced the most
  // expensive possible automation. Omitting it is now the same as sending an
  // empty one, and both are refused below with a typed 422.
  filters: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
  alertType: alertTypeEnum.optional(),
});

const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: alertTypeEnum.nullable().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  actionParams: z.record(z.string(), z.unknown()).optional(),
});

function toTriggerResponse(trigger: Trigger) {
  return {
    id: trigger.id,
    name: trigger.name,
    action: trigger.action,
    actionParams: (trigger.actionParams ?? {}) as Record<string, unknown>,
    filters: trigger.filters,
    active: trigger.active,
    message: trigger.message,
    alertType: trigger.alertType,
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
  };
}

/** REST for the project's automations, `/api/triggers`. */
export function createTriggerRestApp(options: {
  security: AppRestSecurity;
  automation: () => AutomationService;
  platformUrl: PlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, automation, platformUrl } = options;

  const secured = security.createProjectApp({ basePath: "/api/triggers" });

  const automationDrawerPath = (triggerId: string) =>
    `/automations?drawer.open=automation&drawer.automationId=${triggerId}`;

  // ── List Triggers ──────────────────────────────────────────
  secured.access(requires("triggers:view")).get(
    "/",
    describeRoute({
      description: "List all active triggers (automations) for the project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(triggerResponseWithPlatformUrlSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing triggers");

      const triggers = await automation().getAllForProject({
        projectId: project.id,
      });

      return c.json(
        triggers.map((t) => ({
          ...toTriggerResponse(t),
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: automationDrawerPath(t.id),
          }),
        })),
      );
    },
  );

  // ── Get Trigger ────────────────────────────────────────────
  secured.access(requires("triggers:view")).get(
    "/:id",
    describeRoute({
      description: "Get a trigger by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(triggerResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Trigger not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, triggerId: id }, "Getting trigger");

      const trigger = await automation().tryGetById({
        triggerId: id,
        projectId: project.id,
      });

      if (!trigger || trigger.deleted) {
        return c.json({ error: "Trigger not found" }, 404);
      }

      return c.json({
        ...toTriggerResponse(trigger),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: automationDrawerPath(trigger.id),
        }),
      });
    },
  );

  // ── Create Trigger ─────────────────────────────────────────
  // Creating asks for `triggers:create`; `:manage` still implies it, so no
  // existing caller changes and a viewer is declined as before.
  secured.access(requires("triggers:create")).post(
    "/",
    describeRoute({
      description: "Create a new trigger (automation)",
      responses: {
        ...baseResponses,
        201: {
          description: "Trigger created",
          content: {
            "application/json": {
              schema: resolver(triggerResponseWithPlatformUrlSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createTriggerSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id }, "Creating trigger");

      // This route only ever writes trace automations (it carries no graph or
      // report shape), so a condition is always required.
      if (!hasActionableTriggerFilters(body.filters ?? {})) {
        throw new TriggerFiltersRequiredError();
      }

      const trigger = await automation().create({
        id: nanoid(),
        name: body.name,
        action: body.action,
        actionParams: body.actionParams,
        filters: body.filters ?? {},
        projectId: project.id,
        message: body.message ?? null,
        alertType: body.alertType ?? null,
      });

      return c.json(
        {
          ...toTriggerResponse(trigger),
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: automationDrawerPath(trigger.id),
          }),
        },
        201,
      );
    },
  );

  // ── Update Trigger ─────────────────────────────────────────
  secured.access(requires("triggers:update")).patch(
    "/:id",
    describeRoute({
      description: "Update a trigger (name, active state, message, filters)",
      responses: {
        ...baseResponses,
        200: {
          description: "Trigger updated",
          content: {
            "application/json": {
              schema: resolver(triggerResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Trigger not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateTriggerSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, triggerId: id }, "Updating trigger");

      const service = automation();
      const trigger = await service.tryGetById({
        triggerId: id,
        projectId: project.id,
      });

      if (!trigger || trigger.deleted) {
        return c.json({ error: "Trigger not found" }, 404);
      }

      // Editing is the other route to a match-everything automation: create one
      // with a real condition, then patch the condition away. An automation whose
      // condition lives in its query keeps a legitimately empty structured set,
      // and alerts and reports have no trace condition to require at all.
      if (
        body.filters !== undefined &&
        !hasActionableTriggerFilters(body.filters) &&
        trigger.triggerKind === "AUTOMATION" &&
        (trigger.filterQuery ?? "").trim() === ""
      ) {
        throw new TriggerFiltersRequiredError();
      }

      const data: UpdateTriggerCommand = {
        id,
        projectId: project.id,
      };
      if (body.name !== undefined) data.name = body.name;
      if (body.active !== undefined) data.active = body.active;
      if (body.message !== undefined) data.message = body.message;
      if (body.alertType !== undefined) data.alertType = body.alertType;
      if (body.filters !== undefined) data.filters = body.filters;
      if (body.actionParams !== undefined) data.actionParams = body.actionParams;

      const updated = await service.update({
        ...data,
      });

      return c.json({
        ...toTriggerResponse(updated),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: automationDrawerPath(updated.id),
        }),
      });
    },
  );

  // ── Delete Trigger ─────────────────────────────────────────
  // Destruction deliberately stays at `:manage`.
  secured.access(requires("triggers:manage")).delete(
    "/:id",
    describeRoute({
      description: "Delete (soft-delete) a trigger",
      responses: {
        ...baseResponses,
        200: {
          description: "Trigger deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), deleted: z.boolean() })),
            },
          },
        },
        404: {
          description: "Trigger not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, triggerId: id }, "Deleting trigger");

      const service = automation();
      const trigger = await service.tryGetById({
        triggerId: id,
        projectId: project.id,
      });

      if (!trigger || trigger.deleted) {
        return c.json({ error: "Trigger not found" }, 404);
      }

      await service.softDeleteById({
        triggerId: id,
        projectId: project.id,
      });
      await service.removeReportSchedule({
        triggerId: id,
        projectId: project.id,
      });

      return c.json({ id, deleted: true });
    },
  );

  return secured;
}
