import { z } from "zod";
import { automationFilterValueSchema, automationFiltersSchema } from "./automation-filters";
import { MAX_TRACE_DEBOUNCE_MS, MIN_TRACE_DEBOUNCE_MS } from "./cadences";
import { graphAlertActionParamsSchema } from "./graph-alert";
import { reportActionParamsSchema } from "./report";
import {
  alertTypeSchema,
  notificationCadenceSchema,
  triggerActionSchema,
  triggerTemplateDraftSchema,
} from "./trigger";

/**
 * The transport inputs the automation authoring and activity surface
 * publishes.
 *
 * They live in the contract rather than beside the router because the input an
 * author has to send is part of what this feature promises. The command shapes
 * in `trigger.commands.ts` are a different contract: those describe what
 * `AutomationService` accepts, these describe what a client sends.
 */

/** The project an automation call is about, and the whole input of five reads. */
export const automationApiProjectScopeSchema = z.object({ projectId: z.string() });
export type AutomationApiProjectScope = z.infer<typeof automationApiProjectScopeSchema>;

/** One automation in one project. */
export const automationApiTriggerScopeSchema = z.object({
  projectId: z.string(),
  triggerId: z.string(),
});
export type AutomationApiTriggerScope = z.infer<typeof automationApiTriggerScopeSchema>;

/**
 * Per-trigger trace-readiness debounce. Constrained on the wire so a hostile or
 * buggy client can't pin a trace in the settle stage indefinitely.
 */
export const automationApiTraceDebounceMsSchema = z
  .number()
  .int()
  .min(MIN_TRACE_DEBOUNCE_MS)
  .max(MAX_TRACE_DEBOUNCE_MS);

/** The automation a test fire is rendering the message for. */
export const automationApiTriggerIdentitySchema = z.object({
  name: z.string(),
  alertType: alertTypeSchema.nullable().default(null),
});
export type AutomationApiTriggerIdentity = z.infer<typeof automationApiTriggerIdentitySchema>;

/** Validates filter value structure without restricting field names. */
export const automationApiPermissiveFiltersSchema = z.record(
  z.string(),
  automationFilterValueSchema,
);

export const automationApiActionParamsSchema = z.object({
  // createdByUserId is server-stamped from the session — the wire MUST NOT
  // carry it or a hostile client can forge audit attribution
  // (builder5015-002 / applyr-002).
  members: z.string().array().optional(),
  slackWebhook: z.string().optional(),
  // ADR-041 Slack bot delivery. `slackBotToken` arrives as plaintext (or the
  // "kept" sentinel / blank on edit) and is encrypted server-side before
  // persist; it is never returned to the client. `slackBotTokenSet` is a
  // read-only echo the client ignores on the way in.
  slackDelivery: z.enum(["webhook", "bot"]).optional(),
  slackBotToken: z.string().optional(),
  slackChannelId: z.string().optional(),
  slackBotTokenSet: z.boolean().optional(),
  datasetId: z.string().optional(),
  datasetMapping: z
    .object({ mapping: z.unknown(), expansions: z.array(z.string()).optional() })
    .optional(),
  annotators: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  // ADR-040 SEND_WEBHOOK destination — the per-action provider schema
  // re-validates the shape (https-only URL, sanitized headers) below.
  url: z.string().optional(),
  method: z.enum(["POST", "PUT", "PATCH"]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().nullable().optional(),
});
export type AutomationApiActionParams = z.infer<typeof automationApiActionParamsSchema>;

/**
 * The legacy create path. Narrower than `automationApiActionParamsSchema` on
 * purpose: it carries no webhook destination and no Slack bot connection,
 * which is why the router refuses `SEND_WEBHOOK` here outright.
 */
export const automationApiCreateInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  action: triggerActionSchema,
  filters: automationFiltersSchema,
  notificationCadence: notificationCadenceSchema.optional(),
  actionParams: z.object({
    // createdByUserId is server-stamped — do not accept from wire
    // (builder5015-002 / applyr-002).
    members: z.string().array().optional(),
    slackWebhook: z.string().optional(),
    datasetId: z.string().optional(),
    datasetMapping: z
      .object({
        mapping: z.unknown(),
        expansions: z.array(z.string()).optional(),
      })
      .optional(),
    annotators: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      )
      .optional(),
  }),
});
export type AutomationApiCreateInput = z.infer<typeof automationApiCreateInputSchema>;

export const automationApiRecentFiresInputSchema = z.object({
  projectId: z.string(),
  triggerId: z.string(),
  limit: z.number().int().min(1).max(20).default(20),
});
export type AutomationApiRecentFiresInput = z.infer<typeof automationApiRecentFiresInputSchema>;

export const automationApiWebhookDeliveriesInputSchema = z.object({
  projectId: z.string(),
  triggerId: z.string(),
  limit: z.number().int().min(1).max(50).default(50),
});
export type AutomationApiWebhookDeliveriesInput = z.infer<
  typeof automationApiWebhookDeliveriesInputSchema
>;

export const automationApiRecentActivityInputSchema = z.object({
  projectId: z.string(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type AutomationApiRecentActivityInput = z.infer<
  typeof automationApiRecentActivityInputSchema
>;

export const automationApiToggleTriggerInputSchema = z.object({
  triggerId: z.string(),
  active: z.boolean(),
  projectId: z.string(),
});
export type AutomationApiToggleTriggerInput = z.infer<typeof automationApiToggleTriggerInputSchema>;

export const automationApiListSlackChannelsInputSchema = z.object({
  projectId: z.string(),
  botToken: z.string().nullable().default(null),
  automationId: z.string().optional(),
});
export type AutomationApiListSlackChannelsInput = z.infer<
  typeof automationApiListSlackChannelsInputSchema
>;

export const automationApiUpdateTriggerFiltersInputSchema = z.object({
  triggerId: z.string(),
  projectId: z.string(),
  filters: automationApiPermissiveFiltersSchema,
});
export type AutomationApiUpdateTriggerFiltersInput = z.infer<
  typeof automationApiUpdateTriggerFiltersInputSchema
>;

export const automationApiTestFireInputSchema = z.object({
  projectId: z.string(),
  channel: z.enum(["email", "slack", "webhook"]),
  trigger: automationApiTriggerIdentitySchema,
  draft: triggerTemplateDraftSchema,
  webhook: z.string().url().startsWith("https://hooks.slack.com/").nullable().default(null),
  /** ADR-040 generic HTTP test fire: the full request shape, body
   *  template included (it lives in actionParams, not the four Trigger
   *  template columns). URL shape is re-validated by the provider
   *  schema; the real SSRF gate runs inside the sender. */
  webhookDestination: z
    .object({
      url: z.string().url(),
      method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
      headers: z.record(z.string(), z.string()).default({}),
      bodyTemplate: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** Set when the Slack automation uses a bot connection. `botToken` is
   *  the freshly-typed token (fresh draft); null means "use the saved
   *  automation's stored token", resolved server-side via `automationId`. */
  botDestination: z
    .object({
      channelId: z.string(),
      botToken: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** The saved automation being edited, so a kept (un-retyped) bot token
   *  can be loaded + decrypted for the test fire. */
  automationId: z.string().optional(),
  // Present when the draft is a custom-graph alert: the test message
  // then renders the alert-shaped example context + alert defaults,
  // matching what a real fire sends. Detail fields only shape the
  // example copy — they are not persisted.
  graphAlert: z
    .object({
      graphName: z.string().max(200).optional(),
      metricLabel: z.string().max(200).optional(),
      operator: z.string().max(10).optional(),
      threshold: z.number().optional(),
      timePeriodMinutes: z.number().int().positive().optional(),
    })
    .nullable()
    .default(null),
  // Present when the draft is a scheduled report: the test message then
  // renders the report example context + report defaults, the same pair a
  // scheduled fire sends. `sourceKind` picks the example data, matching
  // the drawer's own preview.
  report: z
    .object({
      sourceKind: z.enum(["traceQuery", "customGraph", "dashboard"]),
    })
    .nullable()
    .default(null),
});
export type AutomationApiTestFireInput = z.infer<typeof automationApiTestFireInputSchema>;

export const automationApiUpsertInputSchema = z.object({
  projectId: z.string(),
  triggerId: z.string().optional(),
  name: z.string().min(1),
  action: triggerActionSchema,
  alertType: alertTypeSchema.nullable().optional(),
  filters: automationFiltersSchema,
  /** ADR-043 Subject facet: the Traces-V2 liqe query the automation is
   *  about. When set, it supersedes `filters` (persisted as `{}`) and the
   *  dispatcher evaluates it in-memory. Trace-subject automations, plus
   *  trace-query REPORTS — where it scopes the traces the report sends. */
  filterQuery: z.string().nullable().optional(),
  customGraphId: z.string().nullable().optional(),
  /** Graph-threshold-alert rule. Present iff this is a graph alert
   *  (`customGraphId` set); merged into `actionParams` before persist
   *  so the dispatcher (cron + event-sourced) reads one shape. */
  graphAlert: graphAlertActionParamsSchema.optional(),
  /** Scheduled-report shape (source + schedule). Present iff this is a
   *  REPORT; mutually exclusive with graphAlert. */
  report: reportActionParamsSchema.optional(),
  actionParams: automationApiActionParamsSchema,
  templates: triggerTemplateDraftSchema,
  notificationCadence: notificationCadenceSchema.optional(),
  traceDebounceMs: automationApiTraceDebounceMsSchema.optional(),
});
export type AutomationApiUpsertInput = z.infer<typeof automationApiUpsertInputSchema>;
