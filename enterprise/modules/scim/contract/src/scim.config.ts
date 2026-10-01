import { Config, environmentBooleanSchema, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";

/** `provenOffboarding` selects one process-wide offboarding path at boot. */
export const scimConfig = Config.define((c) => ({
  provenOffboarding: c.env("SCIM_V2_GRANTS", environmentBooleanSchema.default(false)),
}));

export type ScimServerConfig = ConfigOf<typeof scimConfig>;

/** A blank webhook secret answers 404 so an unconfigured install looks unrouted. */
export const scimSecrets = {
  auth0WebhookSecret: Secret.load("AUTH0_SCIM_WEBHOOK_SECRET", { optional: true }),
} as const;
