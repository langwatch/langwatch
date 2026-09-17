import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Blank does not block boot: the cipher validates the key only when credentials
 * are read or written, allowing deployments that store none to start.
 */
export const secretServerConfigDefinition = RuntimeConfig.define({
  encryptionKey: Config.value(z.string().optional(), { env: "CREDENTIALS_SECRET" }),
});

export type SecretServerConfig = ConfigValue<typeof secretServerConfigDefinition>;

export const secretServerConfigSchema = compileRuntimeConfig(secretServerConfigDefinition);
