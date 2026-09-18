import {
  compileRuntimeConfig,
  deploymentCredentialsSecret,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";

/**
 * Blank does not block boot: the cipher validates the key only when credentials
 * are read or written, allowing deployments that store none to start.
 */
export const secretServerConfigDefinition = RuntimeConfig.define({
  encryptionKey: deploymentCredentialsSecret,
});

export type SecretServerConfig = ConfigValue<typeof secretServerConfigDefinition>;

export const secretServerConfigSchema = compileRuntimeConfig(secretServerConfigDefinition);
