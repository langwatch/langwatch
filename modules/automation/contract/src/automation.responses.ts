/**
 * What the automation tRPC surface answers with. Every shape is one the
 * procedures already returned, kept in the contract rather than the
 * transport so an SDK or a document reads the same statement of an answer.
 */
import { monitorSchema } from "@langwatch/monitor-contract";
import { z } from "zod";

import { customGraphNameRefSchema } from "./custom-graph.ts";
import { automationPersistCapCountSchema } from "./persist-cap.ts";
import { triggerSchema } from "./trigger.ts";

/**
 * One automation as the list renders it: the row, the monitors its conditions
 * name, and the custom graph a graph alert points at.
 */
export const automationListRowSchema = z.object({
  ...triggerSchema.shape,
  checks: z.array(monitorSchema),
  customGraph: customGraphNameRefSchema.nullable(),
});
export type AutomationListRow = z.infer<typeof automationListRowSchema>;

/** The plan's daily ceiling on persist actions, on its own. */
export const automationDailyCapSchema = z.object({ cap: z.number() });

/** The ceiling plus today's confirmed and skipped counts, per automation. */
export const automationDailyCapStatusSchema = z.object({
  cap: z.number(),
  counts: z.record(z.string(), automationPersistCapCountSchema),
});
export type AutomationPersistCapStatus = z.infer<typeof automationDailyCapStatusSchema>;

/** What `deleteById` answers with: the removal landed. */
export const automationDeletedSchema = z.object({ success: z.boolean() }).strict();

/** One Slack conversation the bot token can see. */
export const slackChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrivate: z.boolean(),
});

/**
 * Why a channel listing is short of the workspace. A listing can succeed and
 * still be incomplete, and the two are indistinguishable to the caller unless
 * the gap is named.
 */
export const slackChannelListGapSchema = z.enum(["page_cap", "private_channels_hidden"]);
export type SlackChannelListGap = z.infer<typeof slackChannelListGapSchema>;

export const slackChannelListingSchema = z.object({
  channels: z.array(slackChannelSchema),
  error: z.string().nullable(),
  /** Empty when the listing covers the whole workspace. */
  gaps: z.array(slackChannelListGapSchema),
});
export type SlackChannel = z.infer<typeof slackChannelSchema>;
export type SlackChannelListing = z.infer<typeof slackChannelListingSchema>;
