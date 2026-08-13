import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import {
  type Prisma,
  type Trigger,
  TriggerKind,
} from "~/generated/prisma/client";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { TriggerFiltersRequiredError } from "~/server/app-layer/automations/errors";
import {
  persistPublicApiActionParams,
  redactTriggerForPublicApi,
} from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";
import { hasActionableTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

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
  /** The delivery configuration, with every credential value replaced by the
   *  `[redacted]` placeholder. Which channel is configured, which destination
   *  is set and which header names are in play all survive; the values never
   *  leave. Sending the placeholder back on an update keeps the stored value. */
  actionParams: z.record(z.unknown()),
  filters: z.record(z.unknown()),
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
  actionParams: z.record(z.unknown()).default({}),
  // No default. An omitted condition used to become `{}`, which matches every
  // trace forever, so the easiest possible create call produced the most
  // expensive possible automation. Omitting it is now the same as sending an
  // empty one, and both are refused below with a typed 422.
  filters: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  alertType: alertTypeEnum.optional(),
});

const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: alertTypeEnum.nullable().optional(),
  filters: z.record(z.unknown()).optional(),
  /**
   * Replaces the delivery configuration as a whole rather than merging into
   * it: send the fields this automation should have from now on, and anything
   * left out is removed — omit `headers` and the automation delivers with
   * none, omit `signingSecret` and its deliveries are no longer signed.
   *
   * The one exception is a credential the read hid. Send back the `[redacted]`
   * placeholder (or, for a Slack bot connection, the `slackBotTokenSet` flag
   * the read echoes) and the stored credential is kept, so reading an
   * automation, changing one field and writing the whole object back is safe.
   */
  actionParams: z.record(z.unknown()).optional(),
});

function toTriggerResponse(trigger: Trigger) {
  let filters: Record<string, unknown> = {};
  if (typeof trigger.filters === "string") {
    try {
      filters = JSON.parse(trigger.filters) as Record<string, unknown>;
    } catch {
      filters = {};
    }
  } else if (trigger.filters && typeof trigger.filters === "object") {
    filters = trigger.filters as Record<string, unknown>;
  }

  // Every verb answers through here, so the redaction is applied once for the
  // whole surface: list, read, create, update.
  const { actionParams } = redactTriggerForPublicApi(trigger);

  return {
    id: trigger.id,
    name: trigger.name,
    action: trigger.action,
    actionParams: (actionParams ?? {}) as Record<string, unknown>,
    filters,
    active: trigger.active,
    message: trigger.message,
    alertType: trigger.alertType,
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
  };
}

const secured = createProjectApp({ basePath: "/api/triggers" });

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

    const triggers = await prisma.trigger.findMany({
      where: { projectId: project.id, deleted: false },
      orderBy: { createdAt: "desc" },
    });

    return c.json(
      triggers.map((t) => ({
        ...toTriggerResponse(t),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/automations?drawer.open=automation&drawer.automationId=${t.id}`,
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

    const trigger = await prisma.trigger.findFirst({
      where: { id, projectId: project.id, deleted: false },
    });

    if (!trigger) {
      return c.json({ error: "Trigger not found" }, 404);
    }

    return c.json({
      ...toTriggerResponse(trigger),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/automations?drawer.open=automation&drawer.automationId=${trigger.id}`,
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

    // The channel's own provider owns the at-rest form of its delivery
    // configuration, so a create hands the payload to it. Nothing is stored
    // yet, so a field sent as `[redacted]` (a listing copied into a create
    // call) is dropped rather than saved as that string.
    const actionParams = await persistPublicApiActionParams({
      action: body.action,
      incoming: body.actionParams,
    });

    const trigger = await prisma.trigger.create({
      data: {
        id: nanoid(),
        name: body.name,
        action: body.action,
        actionParams: actionParams as Prisma.InputJsonValue,
        filters: JSON.stringify(body.filters),
        projectId: project.id,
        lastRunAt: new Date().getTime(),
        message: body.message ?? null,
        alertType: body.alertType ?? null,
      },
    });

    await getApp().triggers.invalidate(project.id);

    return c.json(
      {
        ...toTriggerResponse(trigger),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/automations?drawer.open=automation&drawer.automationId=${trigger.id}`,
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

    const trigger = await prisma.trigger.findFirst({
      where: { id, projectId: project.id, deleted: false },
    });

    if (!trigger) {
      return c.json({ error: "Trigger not found" }, 404);
    }

    // Editing is the other route to a match-everything automation: create one
    // with a real condition, then patch the condition away. An automation whose
    // condition lives in its query keeps a legitimately empty structured set,
    // and alerts and reports have no trace condition to require at all.
    if (
      body.filters !== undefined &&
      !hasActionableTriggerFilters(body.filters) &&
      trigger.triggerKind === TriggerKind.AUTOMATION &&
      (trigger.filterQuery ?? "").trim() === ""
    ) {
      throw new TriggerFiltersRequiredError();
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.active !== undefined) data.active = body.active;
    if (body.message !== undefined) data.message = body.message;
    if (body.alertType !== undefined) data.alertType = body.alertType;
    if (body.filters !== undefined) data.filters = JSON.stringify(body.filters);
    // Read-modify-write is the normal integration shape, and a credential the
    // caller never touched comes back to us as the placeholder — or, for a
    // stored bot token, as the flag that says one is set. The channel's
    // provider resolves both against what it stored, so each of those keeps
    // the credential the automation already delivers with.
    if (body.actionParams !== undefined) {
      data.actionParams = await persistPublicApiActionParams({
        action: trigger.action,
        incoming: body.actionParams,
        stored: trigger.actionParams,
      });
    }

    const updated = await prisma.trigger.update({
      where: { id, projectId: project.id },
      data,
    });

    await getApp().triggers.invalidate(project.id);

    return c.json({
      ...toTriggerResponse(updated),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/automations?drawer.open=automation&drawer.automationId=${updated.id}`,
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
            schema: resolver(
              z.object({ id: z.string(), deleted: z.boolean() }),
            ),
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

    const trigger = await prisma.trigger.findFirst({
      where: { id, projectId: project.id, deleted: false },
    });

    if (!trigger) {
      return c.json({ error: "Trigger not found" }, 404);
    }

    await prisma.trigger.update({
      where: { id, projectId: project.id },
      data: { deleted: true, active: false },
    });

    await getApp().triggers.invalidate(project.id);

    return c.json({ id, deleted: true });
  },
);

export const app = secured.hono;
