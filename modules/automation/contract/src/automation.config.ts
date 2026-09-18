import { Config, type ConfigOf } from "@langwatch/config";
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
}));

export type AutomationServerConfig = ConfigOf<typeof automationServerConfig>;
