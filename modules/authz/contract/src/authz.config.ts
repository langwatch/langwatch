import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Parse at the leaf for one answer across processes; blank widens filter
 * predicates so it resolves to absent.
 */
const blankIsAbsent = z
  .string()
  .optional()
  .transform((value) => value?.trim() || void 0);

export const authzServerConfig = Config.define((c) => ({
  epochCacheEnabled: c.env(
    "AUTHZ_EPOCH_CACHE",
    z
      .string()
      .optional()
      .transform((value) => value === "1" || value === "true"),
  ),
  demoProjectId: c.env("DEMO_PROJECT_ID", blankIsAbsent),
  /** The account the demo project's work is attributed to; the project is readable by everybody. */
  demoProjectUserId: c.env("DEMO_PROJECT_USER_ID", blankIsAbsent),
}));

export type AuthzServerConfig = ConfigOf<typeof authzServerConfig>;
