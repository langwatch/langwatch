import { Config, environmentOneOrTrueSchema, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Which product this deployment is and who operates it. Unset `adminEmails`
 * means no operator.
 */
export const saasConfig = Config.define((c) => ({
  isSaas: c.env("IS_SAAS", environmentOneOrTrueSchema),
  adminEmails: c.env("ADMIN_EMAILS", z.string().optional()),
}));

export type SaasServerConfig = ConfigOf<typeof saasConfig>;

/** What a browser is told: which product it is looking at. */
export const saasWebConfigSchema = z.strictObject({
  deployment: z.enum(["saas", "self-hosted"]),
});

export type SaasWebConfig = z.infer<typeof saasWebConfigSchema>;
