import {
  allowInsecureLocalUrls,
  Config,
  publicBaseUrl,
  slackApiBase,
  slackWebhookBase,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

const positiveCount = z.coerce.number().int().positive();

/**
 * Ceilings an automation runs under; all persistence caps are included for display even
 * though only one is used per project.
 */
export const automationServerConfig = Config.define((c) => ({
  emailHourlyCap: c.env("TRIGGER_EMAIL_HOURLY_CAP", positiveCount.default(100)),
  tenantDailyCap: c.env("TRIGGER_EMAIL_TENANT_DAILY_CAP", positiveCount.default(10_000)),
  persistDailyCapFree: c.env("TRIGGER_PERSIST_DAILY_CAP_FREE", positiveCount.default(50)),
  persistDailyCapPaid: c.env("TRIGGER_PERSIST_DAILY_CAP_PAID", positiveCount.default(500)),
  persistDailyCapEnterprise: c.env(
    "TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE",
    positiveCount.default(5_000),
  ),
  /** The deployment's public origin (the shared leaf); absent, nothing sent links back. */
  publicBaseUrl,
  /** Where Slack messages go (the shared leaves); haven points them at outboundsim. */
  slackApiBase,
  slackWebhookBase,
  /** The dev switch (the shared leaf): a webhook automation may then use http or a port. */
  allowInsecureLocalUrls,
}));

export type AutomationServerConfig = ConfigOf<typeof automationServerConfig>;
