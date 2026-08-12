import { z } from "zod";

/**
 * The shape of an automation on the `/api/triggers` surface, stated once for
 * both the tool registrations and the API client.
 *
 * A hand-copied interface is how a field the API returns stops reaching the
 * caller, and how a field it never returns starts being promised to one — so
 * every type here is inferred from the schema next to it rather than written
 * out a second time.
 */

/** What a delivery credential reads as. Sending it back on an update keeps the
 *  stored value, so a read-modify-write never overwrites a live credential. */
export const REDACTED_CREDENTIAL = "[redacted]";

export const TRIGGER_ACTIONS = [
  "SEND_EMAIL",
  "SEND_SLACK_MESSAGE",
  "SEND_WEBHOOK",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
] as const;

export const triggerActionSchema = z.enum(TRIGGER_ACTIONS);
export const alertTypeSchema = z.enum(["CRITICAL", "WARNING", "INFO"]);

/**
 * The delivery configuration each channel reads. Stated per channel so an
 * agent can configure one without a round trip: an email automation states its
 * recipients, a Slack one its destination, a webhook one where the request
 * goes.
 *
 * Each member carries the fields it was given rather than dropping the ones it
 * does not declare — every Slack field is optional, so a webhook destination
 * would otherwise read as an empty Slack one and be sent as nothing.
 */
export const emailActionParamsSchema = z
  .object({
    members: z
      .array(z.string())
      .min(1)
      .describe("Who receives the email. Any address, not only teammates."),
  })
  .passthrough();

export const slackActionParamsSchema = z
  .object({
    slackDelivery: z
      .enum(["webhook", "bot"])
      .optional()
      .describe(
        "How the message reaches Slack. `webhook` posts to an incoming webhook URL, `bot` posts as the LangWatch Slack app. Absent means `webhook`.",
      ),
    slackWebhook: z
      .string()
      .optional()
      .describe(
        "The incoming webhook URL (https://hooks.slack.com/...), for `webhook` delivery. A credential: it reads back as [redacted], and sending [redacted] back keeps the stored one.",
      ),
    slackChannelId: z
      .string()
      .optional()
      .describe("The channel the bot posts in, for `bot` delivery."),
    slackBotToken: z
      .string()
      .optional()
      .describe("The bot token, for `bot` delivery. It never reads back."),
    slackBotTokenSet: z
      .boolean()
      .optional()
      .describe(
        "Read: whether a bot token is stored. Write: true keeps the stored one.",
      ),
  })
  .passthrough();

export const webhookActionParamsSchema = z
  .object({
    url: z
      .string()
      .describe("Where the request goes. https only, and not a private host."),
    method: z.enum(["POST", "PUT", "PATCH"]).optional(),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Static headers sent with every delivery. The values are credentials: they read back as [redacted], and sending [redacted] back keeps the stored ones. Changing `url` means sending the values again in the same call.",
      ),
    bodyTemplate: z
      .string()
      .nullable()
      .optional()
      .describe(
        "A Liquid template for the JSON body. Absent sends the standard LangWatch envelope.",
      ),
    signingSecret: z
      .string()
      .nullable()
      .optional()
      .describe("Signs every delivery so the receiver can verify it."),
  })
  .passthrough();

export const datasetActionParamsSchema = z
  .object({
    datasetId: z
      .string()
      .describe("The dataset matched traces are appended to."),
    datasetMapping: z
      .object({
        mapping: z.record(z.string(), z.unknown()),
        expansions: z.array(z.string()).optional(),
      })
      .describe("How a trace becomes a row in that dataset."),
  })
  .passthrough();

export const annotationQueueActionParamsSchema = z
  .object({
    annotators: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .min(1)
      .describe("Who the queued items go to."),
  })
  .passthrough();

export const actionParamsSchema = z.union([
  emailActionParamsSchema,
  slackActionParamsSchema,
  webhookActionParamsSchema,
  datasetActionParamsSchema,
  annotationQueueActionParamsSchema,
]);

export const graphAlertSchema = z
  .object({
    seriesName: z.string().describe("The series on the graph to watch."),
    operator: z.enum(["gt", "lt", "gte", "lte", "eq"]),
    threshold: z.number(),
    timePeriod: z
      .union([
        z.literal(1),
        z.literal(5),
        z.literal(15),
        z.literal(30),
        z.literal(60),
        z.literal(1440),
      ])
      .describe("The window, in minutes, the series is read over."),
  })
  .describe(
    "The rule an alert fires by. Send it with `customGraphId` and `alertType`.",
  );

/**
 * What a scheduled report renders and when it sends.
 *
 * Structured, like `graphAlert`, rather than a loose record: an agent that
 * cannot see the field names has to guess them, and a guess here is a 422. The
 * version tolerance this file keeps for READS does not apply to a write — the
 * server validates the payload against this same shape either way, so a loose
 * one would only move the rejection later and describe it worse.
 */
export const reportSchema = z
  .object({
    source: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("dashboard"),
          dashboardId: z.string(),
        }),
        z.object({
          kind: z.literal("customGraph"),
          customGraphId: z.string(),
        }),
        z.object({
          kind: z.literal("traceQuery"),
          filters: z.record(z.string(), z.unknown()).optional(),
          metric: z.string().optional(),
          topN: z.number().int().min(1).max(100).optional(),
        }),
      ])
      .describe("What the report renders: a dashboard, one graph, or a table of traces."),
    schedule: z
      .object({
        cron: z
          .string()
          .describe(
            'A 5-field cron expression (minute hour day-of-month month day-of-week), for example "0 9 * * 1". It can send at most every 15 minutes.',
          ),
        timezone: z
          .string()
          .describe('An IANA timezone, for example "Europe/Amsterdam" or "UTC".'),
      })
      .describe("When it sends."),
    compareToPrevious: z
      .boolean()
      .optional()
      .describe("Include a this-period-versus-last comparison."),
  })
  .describe(
    "What a scheduled report renders and when. Send it with a channel that can carry a message: email or Slack.",
  );

export const templatesSchema = z
  .object({
    slackTemplateType: z.enum(["string", "block_kit"]).nullable().optional(),
    slackTemplate: z.string().nullable().optional(),
    emailSubjectTemplate: z.string().nullable().optional(),
    emailBodyTemplate: z.string().nullable().optional(),
  })
  .describe(
    "The Liquid templates the message is rendered from. Absent fields render the LangWatch default.",
  );

export const notificationCadenceSchema = z
  .enum(["immediate", "5min_digest", "15min_digest", "hourly_digest"])
  .describe(
    "How often a notification automation may send. A new one starts on a five-minute digest.",
  );

/**
 * What a read answers with. Permissive on purpose: an MCP client talks to
 * whichever LangWatch it is pointed at, so an unknown field is carried through
 * rather than dropped, and a field a given deployment does not send yet is
 * absent rather than fatal.
 */
export const triggerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    action: z.string(),
    /** Where it delivers. The rule it fires by is stated separately, below,
     *  the same way a write states it. */
    actionParams: z.record(z.string(), z.unknown()).default({}),
    graphAlert: graphAlertSchema.nullable().optional(),
    // A read stays tolerant of a deployment that words this differently; a
    // write is held to `reportSchema`.
    report: z.record(z.string(), z.unknown()).nullable().optional(),
    filters: z.record(z.string(), z.unknown()).default({}),
    filterQuery: z.string().nullable().optional(),
    kind: z.string().optional(),
    customGraphId: z.string().nullable().optional(),
    notificationCadence: z.string().nullable().optional(),
    traceDebounceMs: z.number().nullable().optional(),
    templates: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean(),
    message: z.string().nullable(),
    alertType: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    platformUrl: z.string().optional(),
  })
  .passthrough();

export const triggerFireSchema = z
  .object({
    id: z.string(),
    triggerId: z.string(),
    customGraphId: z.string().nullable(),
    firedAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .passthrough();

export const testFireResultSchema = z
  .object({
    channel: z.string(),
    recipientCount: z.number(),
    usedDefault: z.boolean(),
    missingVariables: z.array(z.string()).default([]),
    errors: z.array(z.string()).default([]),
    httpStatus: z.number().optional(),
  })
  .passthrough();

export const deletedTriggerSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
});

export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerFire = z.infer<typeof triggerFireSchema>;
export type TestFireResult = z.infer<typeof testFireResultSchema>;
export type TriggerAction = z.infer<typeof triggerActionSchema>;
export type TriggerAlertType = z.infer<typeof alertTypeSchema>;
export type TriggerActionParams = z.infer<typeof actionParamsSchema>;
export type GraphAlertRule = z.infer<typeof graphAlertSchema>;
export type ReportRule = z.infer<typeof reportSchema>;
export type TriggerTemplates = z.infer<typeof templatesSchema>;
export type NotificationCadence = z.infer<typeof notificationCadenceSchema>;
