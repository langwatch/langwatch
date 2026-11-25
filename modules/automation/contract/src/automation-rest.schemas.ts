import type { Named } from "@langwatch/module";
/**
 * What the automation REST doors send and answer: `/api/triggers`, the
 * older `/api/trigger/slack`, and `/api/unsubscribe` (RFC 8058) share
 * this file since every shape is one those doors already published.
 */
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import { automationFiltersSchema, automationFilterValueSchema } from "./automation-filters.ts";
import type { TriggerFireCursor } from "./automation.trpc-schemas.ts";
import { MAX_TRACE_DEBOUNCE_MS, MIN_TRACE_DEBOUNCE_MS, NOTIFICATION_CADENCES } from "./cadences.ts";
import { graphAlertActionParamsSchema } from "./graph-alert.ts";
import { slackTemplateTypeSchema } from "./providers/slack.ts";
import { reportActionParamsSchema } from "./report.ts";
import { testFireResultSchema } from "./test-fire.ts";

/** Every channel the REST family can create an automation on. */
export const automationRestActionSchema = z.enum([
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
  "SEND_WEBHOOK",
]);

export const automationRestAlertTypeSchema = z.enum(["CRITICAL", "WARNING", "INFO"]);

/**
 * The delivery configuration each channel reads, stated per channel: the wire
 * names, credentials read back as the placeholder. The channel's own schema
 * still rules; `automation-rest.public-api-action-params` holds each to its fields.
 */
const automationRestEmailActionParamsSchemaDefinition = z
  .object({
    members: z
      .array(z.string())
      .min(1)
      .describe("Who receives the email. Any address, not only teammates."),
  })
  .loose()
  .describe("Email delivery.");
export interface AutomationRestEmailActionParamsSchema extends Named<
  typeof automationRestEmailActionParamsSchemaDefinition
> {}
export const automationRestEmailActionParamsSchema: AutomationRestEmailActionParamsSchema =
  automationRestEmailActionParamsSchemaDefinition;

const automationRestSlackActionParamsSchemaDefinition = z
  .object({
    slackIntegrationId: z
      .string()
      .optional()
      .describe(
        "The Slack connection this automation posts through: an organization connection or one " +
          "of this project's, listed under Settings, Integrations, Slack. A bot connection also " +
          "needs `slackChannelId`; a webhook connection needs nothing else. Preferred over " +
          "`slackWebhook` and `slackBotToken`, and what a read returns in their place.",
      ),
    slackDelivery: z
      .enum(["webhook", "bot"])
      .optional()
      .describe(
        "How the message reaches Slack. `webhook` posts to an incoming webhook URL, `bot` posts " +
          "as the LangWatch Slack app. With `slackIntegrationId` it follows the connection's " +
          "kind. Absent without a connection means `webhook`.",
      ),
    slackWebhook: z
      .string()
      .optional()
      .describe(
        "Legacy, accepted for one release: an incoming webhook URL, for `webhook` delivery. It " +
          "is stored as a Slack connection (an existing one holding the same URL, else a new " +
          "project connection) and the automation keeps only that connection's id. Send " +
          "`slackIntegrationId` instead.",
      ),
    slackChannelId: z
      .string()
      .optional()
      .describe(
        "The channel the bot posts in, for a bot connection or `bot` delivery. Invite the " +
          "LangWatch app to it first.",
      ),
    slackBotToken: z
      .string()
      .optional()
      .describe(
        "Legacy, accepted for one release: a bot token, for `bot` delivery. It is stored as a " +
          "Slack connection (an existing one holding the same token, else a new project " +
          "connection) and never reads back. Send `slackIntegrationId` instead.",
      ),
    slackBotTokenSet: z
      .boolean()
      .optional()
      .describe(
        "Legacy and ignored: no read returns it. An update that retypes no secret moves an " +
          "automation's own stored secret into a connection.",
      ),
  })
  .loose()
  .describe(
    "Slack delivery through a Slack connection (`slackIntegrationId`), plus `slackChannelId` " +
      "when the connection is a bot.",
  );
export interface AutomationRestSlackActionParamsSchema extends Named<
  typeof automationRestSlackActionParamsSchemaDefinition
> {}
export const automationRestSlackActionParamsSchema: AutomationRestSlackActionParamsSchema =
  automationRestSlackActionParamsSchemaDefinition;

const automationRestWebhookActionParamsSchemaDefinition = z
  .object({
    url: z.string().describe("Where the request goes. https only, and not a private host."),
    method: z
      .enum(["POST", "PUT", "PATCH"])
      .optional()
      .describe("The HTTP method. Absent means POST."),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Static headers sent with every delivery. The values are credentials: they read back as " +
          "the placeholder, and sending the placeholder back keeps the stored ones. Changing " +
          "`url` means sending the values again in the same request.",
      ),
    bodyTemplate: z
      .string()
      .nullable()
      .optional()
      .describe(
        "A Liquid template for the body. Absent sends the standard LangWatch envelope for a JSON " +
          "content type, and an empty body for any other.",
      ),
    contentType: z
      .string()
      .optional()
      .describe(
        "The `Content-Type` the delivery announces, which also decides how the body is treated: " +
          "`application/json` (and any `+json` type) is checked and re-serialised; any other " +
          "media type sends the rendered template verbatim. Absent means `application/json`.",
      ),
    signingSecret: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Signs every delivery so the receiver can verify it came from LangWatch. A credential: " +
          "it reads back as the placeholder, and sending the placeholder back keeps the stored one.",
      ),
  })
  .loose()
  .describe("Delivery to a customer endpoint over HTTP, with a body in any media type.");
export interface AutomationRestWebhookActionParamsSchema extends Named<
  typeof automationRestWebhookActionParamsSchemaDefinition
> {}
export const automationRestWebhookActionParamsSchema: AutomationRestWebhookActionParamsSchema =
  automationRestWebhookActionParamsSchemaDefinition;

const automationRestDatasetActionParamsSchemaDefinition = z
  .object({
    datasetId: z.string().describe("The dataset matched traces are appended to."),
    datasetMapping: z
      .object({
        mapping: z.record(z.string(), z.unknown()),
        expansions: z.array(z.string()).optional(),
      })
      .describe("How a trace becomes a row in that dataset."),
  })
  .loose()
  .describe("Append matched traces to a dataset.");
export interface AutomationRestDatasetActionParamsSchema extends Named<
  typeof automationRestDatasetActionParamsSchemaDefinition
> {}
export const automationRestDatasetActionParamsSchema: AutomationRestDatasetActionParamsSchema =
  automationRestDatasetActionParamsSchemaDefinition;

const automationRestAnnotationQueueActionParamsSchemaDefinition = z
  .object({
    annotators: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .min(1)
      .describe("Who the queued items go to."),
  })
  .loose()
  .describe("Queue matched traces for a person to label.");
export interface AutomationRestAnnotationQueueActionParamsSchema extends Named<
  typeof automationRestAnnotationQueueActionParamsSchemaDefinition
> {}
export const automationRestAnnotationQueueActionParamsSchema: AutomationRestAnnotationQueueActionParamsSchema =
  automationRestAnnotationQueueActionParamsSchemaDefinition;

/**
 * Every delivery configuration an update accepts. Each member keeps what it
 * was sent: the service reads the payload against the stored row's channel
 * and refuses a field that channel does not have.
 */
const automationRestAnyActionParamsSchema = z.union([
  automationRestEmailActionParamsSchema,
  automationRestSlackActionParamsSchema,
  automationRestWebhookActionParamsSchema,
  automationRestDatasetActionParamsSchema,
  automationRestAnnotationQueueActionParamsSchema,
]);

/** A stored template type read for the wire: one this family does not publish reads as none. */
const automationRestStoredSlackTemplateTypeSchemaDefinition = slackTemplateTypeSchema
  .nullable()
  .catch(null);
export interface AutomationRestStoredSlackTemplateTypeSchema extends Named<
  typeof automationRestStoredSlackTemplateTypeSchemaDefinition
> {}
export const automationRestStoredSlackTemplateTypeSchema: AutomationRestStoredSlackTemplateTypeSchema =
  automationRestStoredSlackTemplateTypeSchemaDefinition;

const automationRestTemplatesSchemaDefinition = z
  .object({
    slackTemplateType: z.enum(["string", "block_kit"]).nullable().optional(),
    slackTemplate: z.string().nullable().optional(),
    emailSubjectTemplate: z.string().nullable().optional(),
    emailBodyTemplate: z.string().nullable().optional(),
  })
  .describe(
    "The Liquid templates this automation's message is rendered from. Absent fields render the " +
      "LangWatch default for the channel.",
  );
export interface AutomationRestTemplatesSchema extends Named<
  typeof automationRestTemplatesSchemaDefinition
> {}
export const automationRestTemplatesSchema: AutomationRestTemplatesSchema =
  automationRestTemplatesSchemaDefinition;

const notificationCadenceSchema = z
  .enum(NOTIFICATION_CADENCES)
  .describe(
    "How often a notification automation is allowed to send. A new one starts on a five-minute " +
      "digest, which is what keeps a broad condition from sending a message per matching trace.",
  );

const traceDebounceMsSchema = z
  .number()
  .int()
  .min(MIN_TRACE_DEBOUNCE_MS)
  .max(MAX_TRACE_DEBOUNCE_MS)
  .describe("How long to wait for a trace to settle before the conditions are read.");

const filterQuerySchema = z
  .string()
  .nullable()
  .describe(
    "The trace query this automation is about, in the syntax the traces view uses. When set it " +
      "supersedes `filters`.",
  );

const permissiveFiltersSchema = z.record(z.string(), automationFilterValueSchema);

/** One automation, as `/api/triggers` writes it: credentials placeholdered, rule apart. */
const automationRestResponseSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  action: automationRestActionSchema,
  actionParams: z
    .record(z.string(), z.unknown())
    .describe(
      "Where this automation delivers, with every credential value replaced by the `[redacted]` " +
        "placeholder. Which channel is configured, which destination is set and which header " +
        "names are in play all survive; the values never leave; a Slack automation names its " +
        "connection by `slackIntegrationId` and carries no secret. Sending the placeholder back " +
        "on an update keeps the stored value. The rule this automation fires by is not here: it " +
        "is stated in `graphAlert` or `report`, and sending it in this field is refused.",
    ),
  graphAlert: graphAlertActionParamsSchema
    .nullable()
    .describe("The rule an alert fires by. Null for anything that is not one."),
  report: reportActionParamsSchema
    .nullable()
    .describe("What a report renders and when. Null for anything else."),
  filters: z.record(z.string(), z.unknown()),
  filterQuery: z.string().nullable(),
  kind: z
    .enum(["AUTOMATION", "ALERT", "REPORT"])
    .describe(
      "What this automation is about: matching traces, a metric crossing a threshold, or a schedule.",
    ),
  customGraphId: z.string().nullable(),
  notificationCadence: z.string().nullable(),
  traceDebounceMs: z.number().nullable(),
  templates: automationRestTemplatesSchema,
  active: z.boolean(),
  message: z.string().nullable(),
  alertType: automationRestAlertTypeSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string().url(),
});
export interface AutomationRestResponseSchema extends Named<
  typeof automationRestResponseSchemaDefinition
> {}
export const automationRestResponseSchema: AutomationRestResponseSchema =
  automationRestResponseSchemaDefinition;
export type AutomationRestResponse = z.infer<typeof automationRestResponseSchema>;

const automationRestIdParamsSchemaDefinition = z.object({ triggerId: z.string().min(1) });
export interface AutomationRestIdParamsSchema extends Named<
  typeof automationRestIdParamsSchemaDefinition
> {}
export const automationRestIdParamsSchema: AutomationRestIdParamsSchema =
  automationRestIdParamsSchemaDefinition;

/** What every create states, whichever channel it delivers on. */
const createCommonFields = {
  name: z.string().min(1, "name is required"),
  // No default: an omitted condition is refused like an empty one (typed 422).
  filters: permissiveFiltersSchema.optional(),
  filterQuery: filterQuerySchema.optional(),
  message: z.string().optional(),
  alertType: automationRestAlertTypeSchema.optional(),
  customGraphId: z
    .string()
    .optional()
    .describe(
      "Set to make this an alert on that graph. `graphAlert` and `alertType` are then required.",
    ),
  graphAlert: graphAlertActionParamsSchema
    .optional()
    .describe("The rule an alert fires by: series, operator, threshold, window."),
  report: reportActionParamsSchema
    .optional()
    .describe("What a scheduled report renders and when it sends."),
  templates: automationRestTemplatesSchema.optional(),
  notificationCadence: notificationCadenceSchema.optional(),
  traceDebounceMs: traceDebounceMsSchema.optional(),
};

/** The create body, discriminated by the channel it delivers on. */
const automationRestCreateInputSchemaDefinition = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SEND_EMAIL"),
    actionParams: automationRestEmailActionParamsSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("SEND_SLACK_MESSAGE"),
    actionParams: automationRestSlackActionParamsSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("SEND_WEBHOOK"),
    actionParams: automationRestWebhookActionParamsSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("ADD_TO_DATASET"),
    actionParams: automationRestDatasetActionParamsSchema,
    ...createCommonFields,
  }),
  z.object({
    action: z.literal("ADD_TO_ANNOTATION_QUEUE"),
    actionParams: automationRestAnnotationQueueActionParamsSchema,
    ...createCommonFields,
  }),
]);
export interface AutomationRestCreateInputSchema extends Named<
  typeof automationRestCreateInputSchemaDefinition
> {}
export const automationRestCreateInputSchema: AutomationRestCreateInputSchema =
  automationRestCreateInputSchemaDefinition;
export type AutomationRestCreateInput = z.infer<typeof automationRestCreateInputSchema>;

const automationRestUpdateInputSchemaDefinition = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: automationRestAlertTypeSchema.nullable().optional(),
  filters: permissiveFiltersSchema.optional(),
  filterQuery: filterQuerySchema.optional(),
  // Accepted so writing the whole read back is answered: a different channel is refused.
  action: automationRestActionSchema.optional(),
  customGraphId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The graph this alert watches, which an update cannot change. Accepted " +
        "so that writing the read response back works; a different graph is " +
        "refused. Create an alert on the other graph and delete this one.",
    ),
  actionParams: automationRestAnyActionParamsSchema
    .optional()
    .describe(
      "Replaces the delivery configuration as a whole rather than merging into it: send the " +
        "fields this automation should have from now on, and anything left out is removed. The " +
        "one exception is a credential the read hid: send back the `[redacted]` placeholder and " +
        "the stored credential is kept (a Slack automation not yet on a connection has its " +
        "stored secret moved into one), so reading an automation, changing one field and " +
        "writing the whole object back is safe. Only this channel's fields are accepted; " +
        "anything else is refused rather than dropped, and the rule this automation fires by " +
        "belongs in `graphAlert` or `report`.",
    ),
  graphAlert: graphAlertActionParamsSchema
    .optional()
    .describe("The rule this alert fires by. Only for an automation that is one."),
  report: reportActionParamsSchema
    .optional()
    .describe("What this report renders and when. Only for one that is a report."),
  templates: automationRestTemplatesSchema.optional(),
  notificationCadence: notificationCadenceSchema.optional(),
  traceDebounceMs: traceDebounceMsSchema.optional(),
});
export interface AutomationRestUpdateInputSchema extends Named<
  typeof automationRestUpdateInputSchemaDefinition
> {}
export const automationRestUpdateInputSchema: AutomationRestUpdateInputSchema =
  automationRestUpdateInputSchemaDefinition;
export type AutomationRestUpdateInput = z.infer<typeof automationRestUpdateInputSchema>;

const automationRestDeletedSchemaDefinition = z.object({
  id: z.string(),
  deleted: z.boolean(),
});
export interface AutomationRestDeletedSchema extends Named<
  typeof automationRestDeletedSchemaDefinition
> {}
export const automationRestDeletedSchema: AutomationRestDeletedSchema =
  automationRestDeletedSchemaDefinition;

/** The opaque page cursor the REST family hands out: base64url JSON of `(createdAt, id)`. */
export function encodeTriggerFireCursor(cursor: TriggerFireCursor): string {
  // ASCII only (an ISO instant and an id), so `btoa` is exact and the contract stays portable.
  const json = JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id });
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const wireFireCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.string().min(1) });

/** A cursor this family issued, decoded; anything else is the 422 `validation_error`. */
const automationRestFireCursorSchema = z.string().transform((encoded, context) => {
  const decoded = wireFireCursorSchema.safeParse(readCursorJson(encoded));
  if (!decoded.success) {
    context.addIssue({ code: "custom", message: "Not a cursor this endpoint issued." });
    return z.NEVER;
  }
  return { createdAt: toDate(Temporal.Instant.from(decoded.data.createdAt)), id: decoded.data.id };
});

function readCursorJson(encoded: string): unknown {
  try {
    return JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    return undefined;
  }
}

const automationRestFiresQuerySchemaDefinition = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: automationRestFireCursorSchema
    .optional()
    .describe("The `nextCursor` from the previous page. Omit for the newest fires."),
});
export interface AutomationRestFiresQuerySchema extends Named<
  typeof automationRestFiresQuerySchemaDefinition
> {}
export const automationRestFiresQuerySchema: AutomationRestFiresQuerySchema =
  automationRestFiresQuerySchemaDefinition;

const automationRestFirePageSchemaDefinition = z.object({
  fires: z
    .array(
      z.object({
        id: z.string(),
        triggerId: z.string(),
        customGraphId: z.string().nullable(),
        firedAt: z.string(),
        resolvedAt: z.string().nullable(),
      }),
    )
    .describe("One page of fires, newest first."),
  nextCursor: z
    .string()
    .nullable()
    .describe("Pass as `cursor` to read the page after this one. Null on the last page."),
});
export interface AutomationRestFirePageSchema extends Named<
  typeof automationRestFirePageSchemaDefinition
> {}
export const automationRestFirePageSchema: AutomationRestFirePageSchema =
  automationRestFirePageSchemaDefinition;
export type AutomationRestFirePage = z.infer<typeof automationRestFirePageSchema>;

const automationRestTestFireSchemaDefinition = z.object({
  ...testFireResultSchema.shape,
  usedDefault: z
    .boolean()
    .describe(
      "Whether the LangWatch default message was rendered because this automation states no " +
        "template of its own.",
    ),
  httpStatus: z.number().optional().describe("Webhook only: what the endpoint answered with."),
});
export interface AutomationRestTestFireSchema extends Named<
  typeof automationRestTestFireSchemaDefinition
> {}
export const automationRestTestFireSchema: AutomationRestTestFireSchema =
  automationRestTestFireSchemaDefinition;

/** An action that takes no body. */
const automationRestNoBodySchemaDefinition = z.object({});
export interface AutomationRestNoBodySchema extends Named<
  typeof automationRestNoBodySchemaDefinition
> {}
export const automationRestNoBodySchema: AutomationRestNoBodySchema =
  automationRestNoBodySchemaDefinition;

/** The body `/api/trigger/slack` reads, in its own spelling. */
const slackAutomationRestInputSchemaDefinition = z
  .object({
    slack_webhook: z
      .string()
      .url()
      .optional()
      .describe(
        "Incoming webhook URL the alert is posted to. It is stored as a Slack connection this " +
          "project can use (an existing one holding the same URL, else a new project connection). " +
          "Send this or `slack_connection_id`, not both.",
      ),
    slack_connection_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The Slack connection the alert posts through: an organization connection or one of " +
          "this project's, as `GET /api/slack-connections` and `langwatch slack-connection list` " +
          "list them. Send this or `slack_webhook`, not both.",
      ),
    slack_channel_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The channel a bot connection posts in; required with one. Invite the LangWatch app to it first.",
      ),
    name: z.string().describe("How the trigger is listed in the app"),
    message: z.string().optional().describe("Extra line included with each alert"),
    filters: automationFiltersSchema
      .default({})
      .describe("Which traces the trigger fires on. An empty object fires on all of them."),
    alert_type: automationRestAlertTypeSchema,
  })
  .refine(
    (body) => (body.slack_webhook === undefined) !== (body.slack_connection_id === undefined),
    {
      message: "Send exactly one of slack_webhook or slack_connection_id.",
      path: ["slack_connection_id"],
    },
  );
export interface SlackAutomationRestInputSchema extends Named<
  typeof slackAutomationRestInputSchemaDefinition
> {}
export const slackAutomationRestInputSchema: SlackAutomationRestInputSchema =
  slackAutomationRestInputSchemaDefinition;

/** The one sentence `/api/trigger/slack` answers a successful create with. */
const slackAutomationRestCreatedSchemaDefinition = z.object({ message: z.string() });
export interface SlackAutomationRestCreatedSchema extends Named<
  typeof slackAutomationRestCreatedSchemaDefinition
> {}
export const slackAutomationRestCreatedSchema: SlackAutomationRestCreatedSchema =
  slackAutomationRestCreatedSchemaDefinition;

/** What the mail client reads back from `/api/unsubscribe`. */
const unsubscribeRestAcknowledgedSchemaDefinition = z.object({ ok: z.boolean() });
export interface UnsubscribeRestAcknowledgedSchema extends Named<
  typeof unsubscribeRestAcknowledgedSchemaDefinition
> {}
export const unsubscribeRestAcknowledgedSchema: UnsubscribeRestAcknowledgedSchema =
  unsubscribeRestAcknowledgedSchemaDefinition;
