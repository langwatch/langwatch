/**
 * What the checkup page shows of the usage report
 * (specs/self-hosting/checkup/checkup.feature, "What we send").
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** What a customer switched off. Both on unless someone switched them off. */
const usageReportSwitchesSchemaDefinition = z.object({
  /** The optional category as a whole. */
  optional: z.boolean(),
  /** Hostname, which names the customer's own network. */
  hostname: z.boolean(),
});
export interface UsageReportSwitchesSchema extends Named<
  typeof usageReportSwitchesSchemaDefinition
> {}
export const usageReportSwitchesSchema: UsageReportSwitchesSchema =
  usageReportSwitchesSchemaDefinition;
export type UsageReportSwitches = z.infer<typeof usageReportSwitchesSchema>;

export const USAGE_REPORT_SWITCHES_ON: UsageReportSwitches = { optional: true, hostname: true };

/** Where an install that has never reported shows its identity: the page reads and never mints. */
export const INSTANCE_ID_NOT_MINTED = "(minted on the first report)";

/**
 * An install admin reads the whole install's report and where it goes; an organization
 * caller reads its own organization's figures, and the install-wide fields are absent.
 */
const usageReportPreviewSchemaDefinition = z.object({
  /** The payload, exactly as it would be posted; one organization's figures for its members. */
  payload: z.record(z.string(), z.unknown()),
  switches: usageReportSwitchesSchema.optional(),
  /** Where it goes. */
  endpoint: z.string().optional(),
  /** DISABLE_USAGE_STATS is set: the payload is what would go, and it does not. */
  disabled: z.boolean().optional(),
  schemaVersion: z.number().int(),
  /** When the sender next posts, or null while reporting is off. */
  nextReportAt: z.string().nullable().optional(),
});
export interface UsageReportPreviewSchema extends Named<
  typeof usageReportPreviewSchemaDefinition
> {}
export const usageReportPreviewSchema: UsageReportPreviewSchema =
  usageReportPreviewSchemaDefinition;
export type UsageReportPreview = z.infer<typeof usageReportPreviewSchema>;
