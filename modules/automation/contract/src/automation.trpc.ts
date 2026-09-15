/**
 * Every `automation.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the automations page has always
 * called, in the order the authoring drawer and the list reach them.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  automationDailyCapSchema,
  automationDailyCapStatusSchema,
  automationDeletedSchema,
  automationListRowSchema,
  slackChannelListingSchema,
} from "./automation.responses.ts";
import {
  automationApiCreateInputSchema,
  automationApiListSlackChannelsInputSchema,
  automationApiProjectScopeSchema,
  automationApiRecentActivityInputSchema,
  automationApiRecentFiresInputSchema,
  automationApiTestFireInputSchema,
  automationApiToggleTriggerInputSchema,
  automationApiTriggerScopeSchema,
  automationApiUpdateTriggerFiltersInputSchema,
  automationApiUpsertInputSchema,
  automationApiWebhookDeliveriesInputSchema,
} from "./automation.trpc-schemas.ts";
import { testFireResultSchema } from "./test-fire.ts";
import { triggerSchema } from "./trigger.ts";
import {
  reportScheduleStatusSchema,
  triggerFireRowSchema,
  triggerFireStatsSchema,
} from "./trigger.queries.ts";
import { webhookDeliveryRowSchema } from "./webhook-delivery.ts";

export const automationTrpc = defineTrpcContract("automation")
  .mutation("create")
  .withInput(automationApiCreateInputSchema)
  .withOutput(triggerSchema)

  .mutation("deleteById")
  .withInput(automationApiTriggerScopeSchema)
  .withOutput(automationDeletedSchema)

  .query("getTriggers")
  .withInput(automationApiProjectScopeSchema)
  .withOutput(automationListRowSchema.array())

  /**
   * The plan's daily ceiling on persist actions, on its own. The authoring
   * drawer only advises against the ceiling and never reads a count, so it
   * takes this rather than the status below and skips a scan it would discard.
   */
  .query("getDailyCap")
  .withInput(automationApiProjectScopeSchema)
  .withOutput(automationDailyCapSchema)

  .query("getDailyCapStatus")
  .withInput(automationApiProjectScopeSchema)
  .withOutput(automationDailyCapStatusSchema)

  .query("getTriggerStats")
  .withInput(automationApiProjectScopeSchema)
  .withOutput(triggerFireStatsSchema.array())

  .query("getRecentFires")
  .withInput(automationApiRecentFiresInputSchema)
  .withOutput(triggerFireRowSchema.array())

  /** ADR-040 §6: the per-attempt webhook delivery log for one automation. */
  .query("getWebhookDeliveries")
  .withInput(automationApiWebhookDeliveriesInputSchema)
  .withOutput(webhookDeliveryRowSchema.array())

  .query("getRecentActivity")
  .withInput(automationApiRecentActivityInputSchema)
  .withOutput(triggerFireRowSchema.array())

  /**
   * When each report next runs and last ran. The cron on the trigger only
   * DESCRIBES the schedule - the scheduler owns the actual instants.
   */
  .query("getReportSchedules")
  .withInput(automationApiProjectScopeSchema)
  .withOutput(reportScheduleStatusSchema.array())

  .mutation("toggleTrigger")
  .withInput(automationApiToggleTriggerInputSchema)
  .withOutput(triggerSchema)

  .query("getTriggerById")
  .withInput(automationApiTriggerScopeSchema)
  .withOutput(triggerSchema.nullable())

  /** The Slack channels a bot token can see, for the channel picker (ADR-041). */
  .mutation("listSlackChannels")
  .withInput(automationApiListSlackChannelsInputSchema)
  .withOutput(slackChannelListingSchema)

  .mutation("updateTriggerFilters")
  .withInput(automationApiUpdateTriggerFiltersInputSchema)
  .withOutput(triggerSchema)

  .mutation("testFireTemplate")
  .withInput(automationApiTestFireInputSchema)
  .withOutput(testFireResultSchema)

  .mutation("upsert")
  .withInput(automationApiUpsertInputSchema)
  .withOutput(triggerSchema)
  .build();
