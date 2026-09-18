import { Config, environmentOneOrTrueSchema, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * The key to verify license signatures. Absent is normal (embedded production
 * key); blank resolves to absent and refuses every license.
 */
export const licensingConfig = Config.define((c) => ({
  isSaas: c.env("IS_SAAS", environmentOneOrTrueSchema),
  publicKey: c.env(
    "LANGWATCH_LICENSE_PUBLIC_KEY",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
}));

export type LicensingServerConfig = ConfigOf<typeof licensingConfig>;
