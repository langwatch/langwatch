import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Whether a permission read may be served from the epoch cache, and which
 * project (if any) every caller may read.
 *
 * `epochCache` reads `1` or `true` and nothing else, which is the reading the
 * platform application already applied. It is parsed at the leaf so both
 * processes reach one answer from one variable rather than each interpreting a
 * string after its own parse. A blank project id is not a project id: a blank
 * value in a filter widens it rather than narrowing it, so blank resolves to
 * absent here rather than at a call site.
 */
const blankIsAbsent = z
  .string()
  .optional()
  .transform((value) => value?.trim() || void 0);

export const authzServerConfigDefinition = RuntimeConfig.define({
  epochCacheEnabled: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value === "1" || value === "true"),
    { env: "AUTHZ_EPOCH_CACHE" },
  ),
  demoProjectId: Config.value(blankIsAbsent, { env: "DEMO_PROJECT_ID" }),
  /** The account the demo project's work is attributed to; the project is readable by everybody. */
  demoProjectUserId: Config.value(blankIsAbsent, { env: "DEMO_PROJECT_USER_ID" }),
});

export type AuthzServerConfig = ConfigValue<typeof authzServerConfigDefinition>;

export const authzServerConfigSchema = compileRuntimeConfig(authzServerConfigDefinition);
