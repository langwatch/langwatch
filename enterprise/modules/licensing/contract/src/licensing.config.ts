import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The key to verify license signatures. Absent is normal (embedded production
 * key); blank resolves to absent and refuses every license.
 */
export const licensingServerConfigDefinition = RuntimeConfig.define({
  publicKey: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
    { env: "LANGWATCH_LICENSE_PUBLIC_KEY" },
  ),
});

export type LicensingServerConfig = ConfigValue<typeof licensingServerConfigDefinition>;

export const licensingServerConfigSchema = compileRuntimeConfig(licensingServerConfigDefinition);
