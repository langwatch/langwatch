import {
  Config,
  compileRuntimeConfig,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * The address fence an outbound provider call is judged by, the engine it is
 * proxied through, and the model a target that names none falls back to.
 *
 * Whether this deployment is the hosted product is not here: that is one fact
 * from one variable and the SaaS feature owns it, so SYSTEM providers are
 * gated explicitly rather than inferred from a provider key a self-hosted
 * install happens to export.
 *
 * `blockLocalHttpCalls` reads `1` or a case-insensitive `true` and nothing
 * else, because a probe answered differently by two processes is a credential
 * that saves on one screen and fails on another. An unset allowlist is an
 * EMPTY one, never a wildcard: a fence that stops fencing because a variable
 * was absent is the failure this leaf prevents.
 */
export const modelProviderServerConfigDefinition = RuntimeConfig.define({
  blockLocalHttpCalls: Config.value(environmentOneOrTrueSchema, {
    env: "BLOCK_LOCAL_HTTP_CALLS",
  }),
  allowedProxyHosts: Config.value(
    z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter((host) => host.length > 0),
      ),
    { env: "ALLOWED_PROXY_HOSTS" },
  ),
  /** The engine address, not the proxy path: the composition root joins them. */
  nlpServiceUrl: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
    { env: "LANGWATCH_NLP_SERVICE" },
  ),
  /** The terminal fallback for a target that names no model; blank is not a model. */
  defaultModel: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
    { env: "LANGWATCH_DEFAULT_MODEL" },
  ),
});

export type ModelProviderServerConfig = ConfigValue<typeof modelProviderServerConfigDefinition>;

export const modelProviderServerConfigSchema = compileRuntimeConfig(
  modelProviderServerConfigDefinition,
);
