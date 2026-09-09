import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The redaction pipeline's two engines and the switch that says whether its
 * verdict is enforced.
 *
 * Where Presidio answers is not here: it is the evaluator service's own
 * address, and the evaluation feature owns that variable so one deployment
 * cannot end up with two of them.
 *
 * `googleDlpDisabled` is carried as written rather than parsed at the leaf:
 * the platform application reads only the literal `true`, and a schema that
 * also accepted `1` would disable DLP in one process and leave it on in the
 * other. `credentials` is carried as written too, because invalid
 * service-account JSON degrades DLP to unavailable rather than failing a boot
 * that has nothing to do with it.
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
