import { z } from "zod";

/** The shape of an automation on the `/api/triggers` surface, stated once for
 *  the tool registrations and the API client. Every type is inferred from its
 *  schema, so what the API sends and what a caller reads cannot drift. */

export const triggerActionSchema = z.enum([
  "SEND_EMAIL",
  "SEND_SLACK_MESSAGE",
  "SEND_WEBHOOK",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
]);
export const alertTypeSchema = z.enum(["CRITICAL", "WARNING", "INFO"]);

/** The delivery configuration each channel reads, stated per channel so an agent
 *  can configure one without a round trip. Each passes unknown fields through:
 *  every Slack field is optional, so a webhook destination would otherwise read
 *  as an empty Slack one and be sent as nothing. */
const emailActionParamsSchema = z
  .object({
    members: z
      .array(z.string())
      .min(1)
      .describe("Who receives the email. Any address, not only teammates."),
  })
  .passthrough();

const slackActionParamsSchema = z
  .object({
    slackIntegrationId: z
      .string()
      .optional()
      .describe(
        "The Slack connection to post through (an organization connection or one of this project's; they are listed in LangWatch under Settings, Integrations, Slack). A bot connection also needs `slackChannelId`; a webhook connection needs nothing else. Preferred over `slackWebhook` and `slackBotToken`.",
      ),
    slackDelivery: z
      .enum(["webhook", "bot"])
      .optional()
      .describe(
        "How the message reaches Slack. `webhook` posts to an incoming webhook URL, `bot` posts as the LangWatch Slack app. With `slackIntegrationId` it follows the connection's kind. Absent without a connection means `webhook`.",
      ),
    slackWebhook: z
      .string()
      .optional()
      .describe(
        "Legacy, accepted for one release: an incoming webhook URL (https://hooks.slack.com/...). It is stored as a Slack connection and the automation keeps only the connection id. Send `slackIntegrationId` instead.",
      ),
    slackChannelId: z
      .string()
      .optional()
      .describe(
        "The channel the bot posts in, for a bot connection or `bot` delivery.",
      ),
    slackBotToken: z
      .string()
      .optional()
      .describe(
        "Legacy, accepted for one release: a bot token, stored as a Slack connection. It never reads back. Send `slackIntegrationId` instead.",
      ),
    slackBotTokenSet: z
      .boolean()
      .optional()
      .describe(
        "Legacy. Read: whether an automation not yet moved to a connection stores its own bot token. Write: true keeps it.",
      ),
  })
  .passthrough();

const webhookActionParamsSchema = z
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

const datasetActionParamsSchema = z
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

const annotationQueueActionParamsSchema = z
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

/** The write-side Slack shape: a redacted read round-trips, but a WRITE with no
 *  destination cannot deliver, so it is refused with the field named. A
 *  connection decides its own kind; without one, the legacy fields need a
 *  webhook URL, or a channel and a token. */
const slackActionParamsWriteSchema = slackActionParamsSchema.superRefine(
  (params, ctx) => {
    const delivery = params.slackDelivery ?? "webhook";
    if (delivery === "bot" && !params.slackChannelId) {
      ctx.addIssue({
        code: "custom",
        path: ["slackChannelId"],
        message: params.slackIntegrationId
          ? "a bot connection needs the channel to post in"
          : "bot delivery needs the channel to post in",
      });
    }
    if (params.slackIntegrationId) return;
    if (delivery === "webhook" && !params.slackWebhook) {
      ctx.addIssue({
        code: "custom",
        path: ["slackIntegrationId"],
        message: "name the Slack connection to post through",
      });
    }
    if (
      delivery === "bot" &&
      !params.slackBotToken &&
      params.slackBotTokenSet !== true
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["slackIntegrationId"],
        message: "bot delivery needs the Slack connection to post through",
      });
    }
  },
);

const ACTION_PARAMS_SCHEMA_BY_ACTION: Partial<
  Record<string, z.ZodTypeAny>
> = {
  SEND_EMAIL: emailActionParamsSchema,
  SEND_SLACK_MESSAGE: slackActionParamsWriteSchema,
  SEND_WEBHOOK: webhookActionParamsSchema,
  ADD_TO_DATASET: datasetActionParamsSchema,
  ADD_TO_ANNOTATION_QUEUE: annotationQueueActionParamsSchema,
};

/** A WRITE's `actionParams` is bound to the channel named in `action`, or a
 *  `SEND_WEBHOOK` with `{}` slips through the all-optional Slack shape and is
 *  refused server-side with worse words. An action this build does not know
 *  validates against the loose union, the tolerance reads keep. */
export function validateActionParamsForAction({
  action,
  actionParams,
}: {
  action: string;
  actionParams: unknown;
}): { ok: true } | { ok: false; message: string } {
  const schema = ACTION_PARAMS_SCHEMA_BY_ACTION[action] ?? actionParamsSchema;
  const parsed = schema.safeParse(actionParams);
  if (parsed.success) return { ok: true };
  const issues = parsed.error.issues
    .map(
      (issue) =>
        `${issue.path.join(".") || "(actionParams)"}: ${issue.message}`,
    )
    .join("; ");
  return {
    ok: false,
    message: `actionParams does not fit ${action} — ${issues}`,
  };
}

/** How `filters` is written. A keyed field sent flat never matches, so each
 *  keyed shape is spelled out; see the `/api/triggers` 422 for the refusal. */
export const TRIGGER_FILTERS_DESCRIPTION = [
  "Trace conditions as a JSON object string.",
  'Unkeyed fields take a list of values: {"traces.error":["true"]}.',
  'Keyed fields nest a key above the list. evaluations.* is keyed by the MONITOR id (the `id` from `platform_list_monitors` / GET /api/monitors, not its evaluatorId): {"evaluations.passed":{"<monitorId>":["false"]}}.',
  'metadata.value is keyed by the metadata key: {"metadata.value":{"<key>":["true"]}}.',
  "A keyed field sent as a bare list, or keyed by anything but a monitor id, is refused.",
].join(" ");

export const TRIGGER_FILTER_QUERY_DESCRIPTION = [
  "Trace query in the syntax the traces view uses; the alternative to `filters`, and it supersedes them.",
  'Examples: status:error · evaluator:"<evaluator name>" AND evaluatorVerdict:fail · trace.attribute.<key>:<value>.',
].join(" ");

/** Stated on the create tool: Slack needs a connection or it never posts. */
export const SLACK_DELIVERY_NOTE =
  'For SEND_SLACK_MESSAGE, send {"slackIntegrationId":"<connection id>"} for a webhook connection, or {"slackIntegrationId":"<connection id>","slackChannelId":"C..."} for a bot connection. Slack connections are listed and added in LangWatch under Settings, Integrations, Slack (organization-wide or for one project); they are also listed by GET /api/slack-connections and `langwatch slack-connection list`, or ask the user for the id. slackIntegrationId is preferred: a legacy {"slackWebhook":"https://hooks.slack.com/..."} or {"slackDelivery":"bot","slackBotToken":"xoxb-...","slackChannelId":"C..."} is still accepted for one release and is stored as a connection. A Slack automation with no connection will never post.';

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

/** What a scheduled report renders and when. Structured, not a loose record: an
 *  agent that cannot see the field names guesses them, and a guess is a 422.
 *  The server holds a write to this same shape, so looseness only delays it. */
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

const triggerFireSchema = z
  .object({
    id: z.string(),
    triggerId: z.string(),
    customGraphId: z.string().nullable(),
    firedAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .passthrough();

/** A page of fires: `{ fires, nextCursor }`, or the bare array an older
 *  deployment answers with, which has no next page. */
export const triggerFirePageSchema = z.union([
  z
    .array(triggerFireSchema)
    .transform((fires) => ({ fires, nextCursor: null })),
  z
    .object({
      fires: z.array(triggerFireSchema).optional(),
      data: z.array(triggerFireSchema).optional(),
      nextCursor: z.string().nullable().optional(),
    })
    .transform(({ fires, data, nextCursor }) => ({
      fires: fires ?? data ?? [],
      nextCursor: nextCursor ?? null,
    })),
]);

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
export type TriggerFirePage = z.infer<typeof triggerFirePageSchema>;
export type TestFireResult = z.infer<typeof testFireResultSchema>;
export type TriggerAction = z.infer<typeof triggerActionSchema>;
export type TriggerAlertType = z.infer<typeof alertTypeSchema>;
export type TriggerActionParams = z.infer<typeof actionParamsSchema>;
export type GraphAlertRule = z.infer<typeof graphAlertSchema>;
export type ReportRule = z.infer<typeof reportSchema>;
export type TriggerTemplates = z.infer<typeof templatesSchema>;
export type NotificationCadence = z.infer<typeof notificationCadenceSchema>;
