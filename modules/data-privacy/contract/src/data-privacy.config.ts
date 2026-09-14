import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Redaction pipeline config: DLP engines and enforcement switch. Some values
 * (googleDlpDisabled, credentials) carried as written for consistency and
 * graceful degradation.
 */
export const dataPrivacyServerConfigDefinition = RuntimeConfig.define({
  googleApplicationCredentials: Config.optionalSecret({ env: "GOOGLE_APPLICATION_CREDENTIALS" }),
  googleDlpDisabled: Config.value(z.union([z.boolean(), z.string()]).optional(), {
    env: "LANGWATCH_DISABLE_GOOGLE_DLP",
  }),
  /** Anything but the literal `off` enforces the native policy. */
  enforcement: Config.value(z.string().optional(), {
    env: "LANGWATCH_DATA_PRIVACY_ENFORCEMENT",
  }),
});

export type DataPrivacyServerConfig = ConfigValue<typeof dataPrivacyServerConfigDefinition>;

export const dataPrivacyServerConfigSchema = compileRuntimeConfig(
  dataPrivacyServerConfigDefinition,
);

/**
 * How long a redaction call may take. Not configurable: the ceiling belongs
 * to the pipeline's own budget, and no deployment has ever set it.
 */
export const DATA_PRIVACY_PRESIDIO_TIMEOUT_MS = 60_000;
