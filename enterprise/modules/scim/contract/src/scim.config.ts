// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Config, environmentBooleanSchema, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/** The previous release spelled this switch `on`/`off`; both spellings stay readable. */
const scimGrantsSwitchSchema = z
  .union([z.literal("on"), z.literal("off")])
  .transform((value) => value === "on")
  .or(environmentBooleanSchema);

/** `provenOffboarding` selects one process-wide offboarding path at boot. */
export const scimConfig = Config.define((c) => ({
  provenOffboarding: c.env("SCIM_V2_GRANTS", scimGrantsSwitchSchema.default(true)),
}));

export type ScimServerConfig = ConfigOf<typeof scimConfig>;

/** A blank webhook secret answers 404 so an unconfigured install looks unrouted. */
export const scimSecrets = {
  auth0WebhookSecret: Secret.load("AUTH0_SCIM_WEBHOOK_SECRET", { optional: true }),
} as const;
