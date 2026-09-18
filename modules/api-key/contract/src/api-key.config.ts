import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * The HMAC key an API key is hashed with, verbatim — a separate leaf from
 * the stored-secret cipher key so the pepper can rotate without
 * re-encrypting every credential. Blank still authenticates; not a refusal.
 */
export const apiKeyServerConfig = Config.define((c) => ({
  pepper: c.env("API_KEY_PEPPER", z.string().optional()),
}));

export type ApiKeyServerConfig = ConfigOf<typeof apiKeyServerConfig>;
