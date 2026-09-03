import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The key an activated Enterprise licence's signature is checked against, at
 * the deployment's own spelling.
 *
 * Optional, and absent is the normal case: the licensing contract embeds the
 * production public key, so a deployment verifies every licence LangWatch
 * issues without configuring anything. The variable exists for ROTATION, and
 * every process that resolves plan entitlements (ADR-027) reads it
 * identically — two processes checking a signature against different keys is
 * one deployment with two answers to whether it is licensed at all.
 */
export const licensingConfigDefinition = RuntimeConfig.define({
  publicKey: Config.value(z.string().optional(), { env: "LANGWATCH_LICENSE_PUBLIC_KEY" }),
});
