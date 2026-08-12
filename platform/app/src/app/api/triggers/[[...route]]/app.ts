import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import type {
  AlertType,
  Trigger,
  TriggerAction,
} from "~/generated/prisma/client";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { PublicApiTriggerService } from "~/server/app-layer/automations/public-api-trigger.service";
import { redactTriggerForPublicApi } from "~/server/app-layer/automations/trigger-redaction";
import { triggerFiltersPermissiveSchema } from "~/server/filters/types";
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
  // Available to projects that deliver on the webhook channel; the save is
  // refused for the rest, so the channel opens here the same day it opens in
  // the dashboard.
  "SEND_WEBHOOK",
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
  /**
   * The delivery configuration, read by the schema its channel publishes: an
   * email automation states its recipients, a Slack one its destination, a
   * dataset one the dataset and how a trace maps onto it. A configuration the
   * channel cannot use is refused, the same way the dashboard refuses it.
   */
  actionParams: z.record(z.unknown()).default({}),
  // No default. An omitted condition used to become `{}`, which matches every
  // trace forever, so the easiest possible create call produced the most
  // expensive possible automation. Omitting it is now the same as sending an
  // empty one, and both are refused below with a typed 422.
  filters: triggerFiltersPermissiveSchema.optional(),
  message: z.string().optional(),
  alertType: alertTypeEnum.optional(),
});

const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: alertTypeEnum.nullable().optional(),
  filters: triggerFiltersPermissiveSchema.optional(),
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

/** Reads and writes go through the service so this surface is held to the same
 *  rules the dashboard is, rather than to whatever the wire schema accepts. */
const triggerService = () => new PublicApiTriggerService(getApp().triggers);

/** Where this automation opens in the dashboard. */
const triggerPlatformUrl = ({
  projectSlug,
  triggerId,
}: {
  projectSlug: string;
  triggerId: string;
}) =>
  platformUrl({
    projectSlug,
    path: `/automations?drawer.open=automation&drawer.automationId=${triggerId}`,
  });

// ── List Triggers ──────────────────────────────────────────
secured.access(requires("triggers:view")).get(
  "/",
  describeRoute({
    description:
      "List the project's automations, newest first. Paused automations are included.",
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

    const triggers = await triggerService().getAll({ projectId: project.id });

    return c.json(
      triggers.map((trigger) => ({
        ...toTriggerResponse(trigger),
        platformUrl: triggerPlatformUrl({
          projectSlug: project.slug,
          triggerId: trigger.id,
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

    const trigger = await triggerService().getById({
      projectId: project.id,
      triggerId: id,
    });

    return c.json({
      ...toTriggerResponse(trigger),
      platformUrl: triggerPlatformUrl({
        projectSlug: project.slug,
        triggerId: trigger.id,
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

    const trigger = await triggerService().create({
      projectId: project.id,
      input: {
        name: body.name,
        action: body.action as TriggerAction,
        actionParams: body.actionParams,
        filters: body.filters,
        message: body.message,
        alertType: body.alertType as AlertType | undefined,
      },
    });

    return c.json(
      {
        ...toTriggerResponse(trigger),
        platformUrl: triggerPlatformUrl({
          projectSlug: project.slug,
          triggerId: trigger.id,
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

    const updated = await triggerService().update({
      projectId: project.id,
      triggerId: id,
      input: {
        name: body.name,
        active: body.active,
        message: body.message,
        alertType: body.alertType as AlertType | null | undefined,
        filters: body.filters,
        actionParams: body.actionParams,
      },
    });

    return c.json({
      ...toTriggerResponse(updated),
      platformUrl: triggerPlatformUrl({
        projectSlug: project.slug,
        triggerId: updated.id,
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

    await triggerService().softDelete({
      projectId: project.id,
      triggerId: id,
    });

    return c.json({ id, deleted: true });
  },
);

export const app = secured.hono;
