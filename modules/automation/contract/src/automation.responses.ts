import type { Named } from "@langwatch/module";
/**
 * What the automation tRPC surface answers with. Every shape is one the
 * procedures already returned, kept in the contract rather than the
 * transport so an SDK or a document reads the same statement of an answer.
 */
import { monitorSchema } from "@langwatch/monitor-contract";
import { z } from "zod";

import { automationPersistCapCountSchema } from "./persist-cap.ts";
import { triggerSchema } from "./trigger.ts";

/** The graph fields automation evaluation and list enrichment need. */
export type CustomGraph = {
  id: string;
  projectId: string;
  name: string;
  graph: unknown;
  filters: unknown;
};

const customGraphNameRefSchemaDefinition = z.object({ id: z.string(), name: z.string() });
export interface CustomGraphNameRefSchema extends Named<
  typeof customGraphNameRefSchemaDefinition
> {}
export const customGraphNameRefSchema: CustomGraphNameRefSchema =
  customGraphNameRefSchemaDefinition;
export type CustomGraphNameRef = z.infer<typeof customGraphNameRefSchema>;

/**
 * One automation as the list renders it: the row, the monitors its conditions
 * name, and the custom graph a graph alert points at.
 */
const automationListRowSchemaDefinition = z.object({
  ...triggerSchema.shape,
  checks: z.array(monitorSchema),
  customGraph: customGraphNameRefSchema.nullable(),
});
export interface AutomationListRowSchema extends Named<typeof automationListRowSchemaDefinition> {}
export const automationListRowSchema: AutomationListRowSchema = automationListRowSchemaDefinition;
export type AutomationListRow = z.infer<typeof automationListRowSchema>;

/** The plan's daily ceiling on persist actions, on its own. */
const automationDailyCapSchemaDefinition = z.object({ cap: z.number() });
export interface AutomationDailyCapSchema extends Named<
  typeof automationDailyCapSchemaDefinition
> {}
export const automationDailyCapSchema: AutomationDailyCapSchema =
  automationDailyCapSchemaDefinition;

/** The ceiling plus today's confirmed and skipped counts, per automation. */
const automationDailyCapStatusSchemaDefinition = z.object({
  cap: z.number(),
  counts: z.record(z.string(), automationPersistCapCountSchema),
});
export interface AutomationDailyCapStatusSchema extends Named<
  typeof automationDailyCapStatusSchemaDefinition
> {}
export const automationDailyCapStatusSchema: AutomationDailyCapStatusSchema =
  automationDailyCapStatusSchemaDefinition;
export type AutomationPersistCapStatus = z.infer<typeof automationDailyCapStatusSchema>;

/** What `deleteById` answers with: the removal landed. */
const automationDeletedSchemaDefinition = z.object({ success: z.boolean() }).strict();
export interface AutomationDeletedSchema extends Named<typeof automationDeletedSchemaDefinition> {}
export const automationDeletedSchema: AutomationDeletedSchema = automationDeletedSchemaDefinition;

/** One Slack conversation the bot token can see. */
const slackChannelSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  isPrivate: z.boolean(),
});
export interface SlackChannelSchema extends Named<typeof slackChannelSchemaDefinition> {}
export const slackChannelSchema: SlackChannelSchema = slackChannelSchemaDefinition;

/**
 * Why a channel listing is short of the workspace. A listing can succeed and
 * still be incomplete, and the two are indistinguishable to the caller unless
 * the gap is named.
 */
export const slackChannelListGapSchema = z.enum(["page_cap", "private_channels_hidden"]);
export type SlackChannelListGap = z.infer<typeof slackChannelListGapSchema>;

const slackChannelListingSchemaDefinition = z.object({
  channels: z.array(slackChannelSchema),
  error: z.string().nullable(),
  /** Empty when the listing covers the whole workspace. */
  gaps: z.array(slackChannelListGapSchema),
});
export interface SlackChannelListingSchema extends Named<
  typeof slackChannelListingSchemaDefinition
> {}
export const slackChannelListingSchema: SlackChannelListingSchema =
  slackChannelListingSchemaDefinition;
export type SlackChannel = z.infer<typeof slackChannelSchema>;
export type SlackChannelListing = z.infer<typeof slackChannelListingSchema>;
