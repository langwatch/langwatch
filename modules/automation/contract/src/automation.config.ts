import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

const positiveCount = z.coerce.number().int().positive();

/**
 * Ceilings an automation runs under; all persistence caps are included for display even
 * though only one is used per project.
 */
export const automationServerConfigDefinition = RuntimeConfig.define({
  emailHourlyCap: Config.value(positiveCount.default(100), { env: "TRIGGER_EMAIL_HOURLY_CAP" }),
  tenantDailyCap: Config.value(positiveCount.default(10_000), {
    env: "TRIGGER_EMAIL_TENANT_DAILY_CAP",
  }),
  persistDailyCapFree: Config.value(positiveCount.default(50), {
    env: "TRIGGER_PERSIST_DAILY_CAP_FREE",
  }),
  persistDailyCapPaid: Config.value(positiveCount.default(500), {
    env: "TRIGGER_PERSIST_DAILY_CAP_PAID",
  }),
  persistDailyCapEnterprise: Config.value(positiveCount.default(5_000), {
    env: "TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE",
  }),
});

export type AutomationServerConfig = ConfigValue<typeof automationServerConfigDefinition>;

export const automationServerConfigSchema = compileRuntimeConfig(automationServerConfigDefinition);
