import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** The platform-operator list the SSO connection guards' D05 tier-1 check
 * reads; blank means none rather than refusing boot. */
const adminEmailsSchema = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? "")
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0),
  );

export const identityConfig = Config.define((c) => ({
  adminEmails: c.env("ADMIN_EMAILS", adminEmailsSchema),
}));

export type IdentityConfig = ConfigOf<typeof identityConfig>;
