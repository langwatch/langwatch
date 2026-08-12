import {
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
  NOTIFICATION_CADENCES,
} from "@langwatch/automations/cadences";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import type { AuthMiddlewareVariables } from "~/app/api/middleware/auth";
import { badRequestSchema } from "~/app/api/shared/schemas";
import type {
  AlertType,
  Trigger,
  TriggerAction,
} from "~/generated/prisma/client";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { AutomationCustomGraphService } from "~/server/app-layer/automations/custom-graph.service";
import { ProjectNotFoundError } from "~/server/app-layer/automations/errors";
import { graphAlertActionParamsSchema } from "~/server/app-layer/automations/graph-alert.builder";
import { PublicApiTriggerService } from "~/server/app-layer/automations/public-api-trigger.service";
import { reportActionParamsSchema } from "~/server/app-layer/automations/report.builder";
import { TriggerFireHistoryService } from "~/server/app-layer/automations/trigger-fire-history.service";
import { redactTriggerForPublicApi } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";
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

/**
 * The delivery configuration each channel reads, stated per channel rather
 * than as a free-form object.
 *
 * These are the WIRE shapes — what an integrator writes and what the read
 * hands back, credentials replaced by the placeholder. The channel's own
 * schema is still the authority on what it will accept (an https-only
 * destination, a Slack connection with a channel, a dataset row with a
 * mapping); these say what the fields are called and what they are for, which
 * is what an agent needs to configure an automation without asking twice.
 * `public-api-action-params.unit.test.ts` holds each one to the field names
 * its channel actually publishes, so the two cannot drift.
 */
const emailActionParamsSchema = z
  .object({
    members: z
      .array(z.string())
      .min(1)
      .describe("Who receives the email. Any address, not only teammates."),
  })
  .describe("Email delivery.");

const slackActionParamsSchema = z
  .object({
    slackDelivery: z
      .enum(["webhook", "bot"])
      .optional()
      .describe(
        "How the message reaches Slack. `webhook` posts to an incoming " +
          "webhook URL, `bot` posts as the LangWatch Slack app. Absent means " +
          "`webhook`.",
      ),
    slackWebhook: z
      .string()
      .optional()
      .describe(
        "The incoming webhook URL, for `webhook` delivery. A credential: it " +
          "reads back as the placeholder, and sending the placeholder back " +
          "keeps the stored one.",
      ),
    slackChannelId: z
      .string()
      .optional()
      .describe("The channel the bot posts in, for `bot` delivery."),
    slackBotToken: z
      .string()
      .optional()
      .describe(
        "The bot token, for `bot` delivery. A credential: it never reads " +
          "back. Send `slackBotTokenSet: true` to keep the stored one.",
      ),
    slackBotTokenSet: z
      .boolean()
      .optional()
      .describe(
        "Read: whether a bot token is stored. Write: `true` keeps the " +
          "stored one.",
      ),
  })
  .describe("Slack delivery, by incoming webhook or by bot connection.");

const webhookActionParamsWireSchema = z
  .object({
    url: z
      .string()
      .describe("Where the request goes. https only, and not a private host."),
    method: z
      .enum(["POST", "PUT", "PATCH"])
      .optional()
      .describe("The HTTP method. Absent means POST."),
    headers: z
      .record(z.string())
      .optional()
      .describe(
        "Static headers sent with every delivery. The values are " +
          "credentials: they read back as the placeholder, and sending the " +
          "placeholder back keeps the stored ones. Changing `url` means " +
          "sending the values again in the same request.",
      ),
    bodyTemplate: z
      .string()
      .nullable()
      .optional()
      .describe(
        "A Liquid template for the JSON body. Absent sends the standard " +
          "LangWatch envelope.",
      ),
    signingSecret: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Signs every delivery so the receiver can verify it came from " +
          "LangWatch. A credential: it reads back as the placeholder, and " +
          "sending the placeholder back keeps the stored one.",
      ),
  })
  .describe("Delivery to a customer endpoint over HTTP.");

const datasetActionParamsWireSchema = z
  .object({
    datasetId: z
      .string()
      .describe("The dataset matched traces are appended to."),
    datasetMapping: z
      .object({
        mapping: z.record(z.unknown()),
        expansions: z.array(z.string()).optional(),
      })
      .describe("How a trace becomes a row in that dataset."),
  })
  .describe("Append matched traces to a dataset.");

const annotationQueueActionParamsWireSchema = z
  .object({
    annotators: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .min(1)
      .describe("Who the queued items go to."),
  })
  .describe("Queue matched traces for a person to label.");

/**
 * Every delivery configuration this API accepts, for the verb where the
 * channel is already fixed by the stored row and so cannot pick the shape.
 *
 * Each member keeps the fields it was sent rather than dropping the ones it
 * does not declare. Several of these shapes are satisfiable by another
 * channel's payload — every Slack field is optional, so a webhook destination
 * reads as an empty Slack one — and a member that dropped what it did not
 * recognise would answer such a save by silently saving nothing. The channel's
 * own schema is the authority on the shape either way; this one says what the
 * fields are called.
 */
const anyActionParamsSchema = z.union([
  emailActionParamsSchema.passthrough(),
  slackActionParamsSchema.passthrough(),
  webhookActionParamsWireSchema.passthrough(),
  datasetActionParamsWireSchema.passthrough(),
  annotationQueueActionParamsWireSchema.passthrough(),
]);

const templatesSchema = z
  .object({
    slackTemplateType: z.enum(["string", "block_kit"]).nullable().optional(),
    slackTemplate: z.string().nullable().optional(),
    emailSubjectTemplate: z.string().nullable().optional(),
    emailBodyTemplate: z.string().nullable().optional(),
  })
  .describe(
    "The Liquid templates this automation's message is rendered from. Absent " +
      "fields render the LangWatch default for the channel.",
  );

const notificationCadenceSchema = z
  .enum(NOTIFICATION_CADENCES)
  .describe(
    "How often a notification automation is allowed to send. A new one " +
      "starts on a five-minute digest, which is what keeps a broad condition " +
      "from sending a message per matching trace.",
  );

const traceDebounceMsSchema = z
  .number()
  .int()
  .min(MIN_TRACE_DEBOUNCE_MS)
  .max(MAX_TRACE_DEBOUNCE_MS)
  .describe(
    "How long to wait for a trace to settle before the conditions are read.",
  );

const filterQuerySchema = z
  .string()
  .nullable()
  .describe(
    "The trace query this automation is about, in the syntax the traces view " +
      "uses. When set it supersedes `filters`.",
  );

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
  filterQuery: z.string().nullable(),
  kind: z
    .enum(["AUTOMATION", "ALERT", "REPORT"])
    .describe(
      "What this automation is about: matching traces, a metric crossing a " +
        "threshold, or a schedule.",
    ),
  customGraphId: z.string().nullable(),
  notificationCadence: z.string().nullable(),
  traceDebounceMs: z.number().nullable(),
  templates: templatesSchema,
  active: z.boolean(),
  message: z.string().nullable(),
  alertType: alertTypeEnum.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const triggerResponseWithPlatformUrlSchema = triggerResponseSchema.extend({
  platformUrl: z.string().url(),
});

/** What every create states, whichever channel it delivers on. */
const createCommonFields = {
  name: z.string().min(1, "name is required"),
  // No default. An omitted condition used to become `{}`, which matches every
  // trace forever, so the easiest possible create call produced the most
  // expensive possible automation. Omitting it is now the same as sending an
  // empty one, and both are refused below with a typed 422.
  filters: triggerFiltersPermissiveSchema.optional(),
  filterQuery: filterQuerySchema.optional(),
  message: z.string().optional(),
  alertType: alertTypeEnum.optional(),
  customGraphId: z
    .string()
    .optional()
    .describe(
      "Set to make this an alert on that graph. `graphAlert` and `alertType` " +
        "are then required.",
    ),
  graphAlert: graphAlertActionParamsSchema
    .optional()
    .describe(
      "The rule an alert fires by: series, operator, threshold, window.",
    ),
  report: reportActionParamsSchema
    .optional()
    .describe("What a scheduled report renders and when it sends."),
  templates: templatesSchema.optional(),
  notificationCadence: notificationCadenceSchema.optional(),
  traceDebounceMs: traceDebounceMsSchema.optional(),
};

/**
 * The create body, discriminated by the channel it delivers on: each channel
 * states the delivery configuration it reads, so a caller (or an agent) can
 * see from the schema alone what a Slack automation needs that an email one
 * does not.
 */
const createTriggerSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SEND_EMAIL"),
    actionParams: emailActionParamsSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("SEND_SLACK_MESSAGE"),
    actionParams: slackActionParamsSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("SEND_WEBHOOK"),
    actionParams: webhookActionParamsWireSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("ADD_TO_DATASET"),
    actionParams: datasetActionParamsWireSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("ADD_TO_ANNOTATION_QUEUE"),
    actionParams: annotationQueueActionParamsWireSchema,
    ...createCommonFields,
  }),
]);

const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: alertTypeEnum.nullable().optional(),
  filters: triggerFiltersPermissiveSchema.optional(),
  filterQuery: filterQuerySchema.optional(),
  /**
   * The channel this automation delivers on, which an update cannot change.
   * Accepted so that writing the whole read response back is answered rather
   * than silently ignored: a different channel is refused. The credential
   * rules that let a read-modify-write keep a stored secret hold precisely
   * because the incoming and the stored delivery configuration belong to the
   * same channel. Create a new automation to deliver somewhere else.
   */
  action: triggerActionEnum.optional(),
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
  actionParams: anyActionParamsSchema.optional(),
  graphAlert: graphAlertActionParamsSchema
    .optional()
    .describe(
      "The rule this alert fires by. Only for an automation that is one.",
    ),
  report: reportActionParamsSchema
    .optional()
    .describe(
      "What this report renders and when. Only for one that is a report.",
    ),
  templates: templatesSchema.optional(),
  notificationCadence: notificationCadenceSchema.optional(),
  traceDebounceMs: traceDebounceMsSchema.optional(),
});

const fireSchema = z.object({
  id: z.string(),
  triggerId: z.string(),
  customGraphId: z.string().nullable(),
  firedAt: z.string(),
  resolvedAt: z.string().nullable(),
});

const testFireSchema = z.object({
  channel: z.enum(["email", "slack", "webhook"]),
  recipientCount: z.number(),
  usedDefault: z
    .boolean()
    .describe(
      "Whether the LangWatch default message was rendered because this " +
        "automation states no template of its own.",
    ),
  missingVariables: z.array(z.string()),
  errors: z.array(z.string()),
  httpStatus: z
    .number()
    .optional()
    .describe("Webhook only: what the endpoint answered with."),
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
    filterQuery: trigger.filterQuery,
    kind: trigger.triggerKind,
    customGraphId: trigger.customGraphId,
    notificationCadence: trigger.notificationCadence,
    traceDebounceMs: trigger.traceDebounceMs,
    templates: {
      slackTemplateType: trigger.slackTemplateType,
      slackTemplate: trigger.slackTemplate,
      emailSubjectTemplate: trigger.emailSubjectTemplate,
      emailBodyTemplate: trigger.emailBodyTemplate,
    },
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
const triggerService = () =>
  new PublicApiTriggerService(getApp().triggers, {
    graphs: AutomationCustomGraphService.create(prisma),
    fireHistory: TriggerFireHistoryService.create(prisma),
    testFire: (input) => getApp().triggerTemplates.testFire(input),
    resolveProject: async (projectId) => {
      const project = await getApp().projects.getById(projectId);
      if (!project) throw new ProjectNotFoundError(projectId);
      return { name: project.name, slug: project.slug };
    },
  });

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

// ── Trigger fire history ───────────────────────────────────
secured.access(requires("triggers:view")).get(
  "/:id/fires",
  describeRoute({
    description:
      "What this automation has done: its fires, newest first. Metadata only — " +
      "no trace ids and no trace content.",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": { schema: resolver(z.array(fireSchema)) },
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
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  ),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    const { limit } = c.req.valid("query");

    const fires = await triggerService().getFireHistory({
      projectId: project.id,
      triggerId: id,
      limit,
    });

    return c.json(
      fires.map((fire) => ({
        id: fire.id,
        triggerId: fire.triggerId,
        customGraphId: fire.customGraphId,
        firedAt: fire.createdAt.toISOString(),
        resolvedAt: fire.resolvedAt ? fire.resolvedAt.toISOString() : null,
      })),
    );
  },
);

// ── Create Trigger ─────────────────────────────────────────
// Creating asks for `triggers:create`; `:manage` still implies it, so no
// existing caller changes and a viewer is declined as before.
secured.access(requires("triggers:create")).post(
  "/",
  describeRoute({
    description:
      "Create an automation. Send `customGraphId` + `graphAlert` for an alert " +
      "on a metric, `report` for a scheduled report, or conditions for a trace " +
      "automation. The delivery channel is fixed at creation.",
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
        actionParams: body.actionParams as Record<string, unknown>,
        filters: body.filters,
        filterQuery: body.filterQuery,
        message: body.message,
        alertType: body.alertType as AlertType | undefined,
        customGraphId: body.customGraphId,
        graphAlert: body.graphAlert,
        report: body.report,
        templates: body.templates,
        notificationCadence: body.notificationCadence,
        traceDebounceMs: body.traceDebounceMs,
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
    description:
      "Update an automation. Every field is optional and what is left out is " +
      "left alone, except `actionParams`, which replaces the delivery " +
      "configuration as a whole. The delivery channel cannot be changed.",
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
        action: body.action as TriggerAction | undefined,
        name: body.name,
        active: body.active,
        message: body.message,
        alertType: body.alertType as AlertType | null | undefined,
        filters: body.filters,
        filterQuery: body.filterQuery,
        actionParams: body.actionParams as Record<string, unknown> | undefined,
        graphAlert: body.graphAlert,
        report: body.report,
        templates: body.templates,
        notificationCadence: body.notificationCadence,
        traceDebounceMs: body.traceDebounceMs,
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

// ── Resume / pause ─────────────────────────────────────────
// Both verbs answer with the automation, so a caller sees the state it is in
// rather than having to read it back. Written out one at a time rather than
// generated from a pair: the route inventory these two appear in is read off
// the source, and a generated registration is invisible to it.
type TriggerRouteContext = Context<
  { Variables: AuthMiddlewareVariables },
  "/:id"
>;

const setActiveHandler =
  (active: boolean) => async (c: TriggerRouteContext) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info(
      { projectId: project.id, triggerId: id, active },
      "Setting trigger active state",
    );

    const updated = await triggerService().setActive({
      projectId: project.id,
      triggerId: id,
      active,
    });

    return c.json({
      ...toTriggerResponse(updated),
      platformUrl: triggerPlatformUrl({
        projectSlug: project.slug,
        triggerId: updated.id,
      }),
    });
  };

const setActiveResponses = (description: string) => ({
  ...baseResponses,
  200: {
    description,
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
});

secured.access(requires("triggers:update")).post(
  "/:id/enable",
  describeRoute({
    description:
      "Resume an automation. A report's schedule is put back on the calendar.",
    responses: setActiveResponses("Trigger resumed"),
  }),
  setActiveHandler(true),
);

secured.access(requires("triggers:update")).post(
  "/:id/disable",
  describeRoute({
    description: "Pause an automation. A report stops claiming its schedule.",
    responses: setActiveResponses("Trigger paused"),
  }),
  setActiveHandler(false),
);

// ── Test fire ──────────────────────────────────────────────
// The destination is the automation's own saved one. A test fire proves that a
// configured automation delivers; it is not a way to send a message anywhere.
secured.access(requires("triggers:update")).post(
  "/:id/test-fire",
  describeRoute({
    description:
      "Send this automation's message to the destination it is configured " +
      "with, so you can confirm it arrives. Nothing is recorded as a fire.",
    responses: {
      ...baseResponses,
      200: {
        description: "Test fire sent",
        content: {
          "application/json": { schema: resolver(testFireSchema) },
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
    logger.info(
      { projectId: project.id, triggerId: id },
      "Test-firing trigger",
    );

    const result = await triggerService().testFire({
      projectId: project.id,
      triggerId: id,
    });

    return c.json(result);
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

/** The delivery configuration each channel publishes on this API, exported so
 *  `public-api-action-params.unit.test.ts` can hold each one to the fields its
 *  channel actually reads. */
export const PUBLIC_API_ACTION_PARAMS_SCHEMAS = {
  SEND_EMAIL: emailActionParamsSchema,
  SEND_SLACK_MESSAGE: slackActionParamsSchema,
  SEND_WEBHOOK: webhookActionParamsWireSchema,
  ADD_TO_DATASET: datasetActionParamsWireSchema,
  ADD_TO_ANNOTATION_QUEUE: annotationQueueActionParamsWireSchema,
} as const;
