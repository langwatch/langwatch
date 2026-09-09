import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The key stored credentials are encrypted with.
 *
 * Optional, and blank is not a boot refusal: whether a value is the right
 * shape for the cipher is the cipher's own rule, applied when a row is
 * written or read, and refusing here would stop a deployment that stores no
 * credentials at all from starting.
 */
export const secretServerConfigDefinition = RuntimeConfig.define({
  encryptionKey: Config.value(z.string().optional(), { env: "CREDENTIALS_SECRET" }),
});

export type SecretServerConfig = ConfigValue<typeof secretServerConfigDefinition>;

export const secretServerConfigSchema = compileRuntimeConfig(secretServerConfigDefinition);
