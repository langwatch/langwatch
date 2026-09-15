import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Parse at the leaf for one answer across processes; blank widens filter
 * predicates so it resolves to absent.
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
