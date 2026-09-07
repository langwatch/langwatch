import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The key an activated licence's signature is checked against.
 *
 * Absent is the normal case: this contract embeds the production public key,
 * so a deployment verifies every licence LangWatch issues without configuring
 * anything, and the variable exists for ROTATION. Blank is not a key — an
 * empty string reaching the verifier refuses every licence the deployment
 * holds — so blank resolves to absent at the leaf, in every process that
 * resolves plan entitlements.
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
