import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

const positiveCount = z.coerce.number().int().positive();

/**
 * The ceilings an automation runs under.
 *
 * The key its stored credentials are read with is not here: that is the
 * stored-secret cipher key, and the secret feature owns it, so an automation
 * cannot end up decrypting with a different key than the one that wrote.
 *
 * All three persistence caps travel together even though a project uses one:
 * the tier is resolved per project at run time, and the automations screen
 * reports the customer's own cap back to them, so a process that carried only
 * the tier it thought it needed would show the wrong number.
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
