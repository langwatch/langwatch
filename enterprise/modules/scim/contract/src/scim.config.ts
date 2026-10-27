// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Config,
  environmentBooleanSchema,
  environmentExactOnSchema,
  publicBaseUrl,
  type ConfigOf,
} from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";

/** true/false/1/0 read as booleans; otherwise only `on` is on, as the previous release read it. */
const scimGrantsSwitchSchema = environmentBooleanSchema.or(environmentExactOnSchema);

/**
 * `provenOffboarding` selects one process-wide offboarding path at boot; `publicBaseUrl` is the
 * shared deployment origin the directory-sync summary card links to.
 */
export const scimConfig = Config.define((c) => ({
  provenOffboarding: c.env("SCIM_V2_GRANTS", scimGrantsSwitchSchema.default(true)),
  publicBaseUrl,
}));

export type ScimServerConfig = ConfigOf<typeof scimConfig>;

/** A blank webhook secret answers 404 so an unconfigured install looks unrouted. */
export const scimSecrets = {
  auth0WebhookSecret: Secret.load("AUTH0_SCIM_WEBHOOK_SECRET", { optional: true }),
} as const;
