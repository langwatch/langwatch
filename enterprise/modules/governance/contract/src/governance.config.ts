// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What this feature is configured with, and the secret handles it resolves.
 * The process parses the schema once and hands the result down; a secret is
 * resolved only through its handle, never read from `process.env`.
 */
import { Config, gatewayLegacyUrl, gatewayPublicUrl, type ConfigOf } from "@langwatch/config";
import { resolveGatewayBaseUrl } from "@langwatch/config/public-app-config/projection";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/**
 * Where the aigateway's OTTL endpoints are, and the shared secret every call
 * to them is signed with. Both nullable together: a deployment with no
 * gateway folds OTTL nowhere, and the channel answers "unconfigured" rather
 * than pretending to transform.
 */
const governanceOttlConfigSchema = z
  .object({
    baseUrl: z.string().min(1).nullable().default(null),
    secret: z.string().min(1).nullable().default(null),
  })
  .default({ baseUrl: null, secret: null });

/**
 * The governance module's configuration slice.
 *
 * `ingestionSecretPepper` defaults to the empty string because that is what
 * the served behaviour is today — an unset pepper hashes an ingestion secret
 * unpeppered rather than refusing to boot. Requiring it is a deliberate
 * hardening, not a conversion, and belongs in its own change.
 */
export const governanceAppConfigSchema = z.object({
  /** Where an issued personal virtual key tells its holder to send traffic. */
  gatewayBaseUrl: z.string().min(1),
  /** This deployment's public origin; the CLI family's links are built on it. */
  publicBaseUrl: z.string().min(1),
  /** Prefixed into an ingestion secret's hash, so a database-only leak is inert. */
  ingestionSecretPepper: z.string().default(""),
  ottl: governanceOttlConfigSchema,
});

export type GovernanceAppConfig = z.infer<typeof governanceAppConfigSchema>;

/** Every stored erasure digest is a function of this value: set it once, never change it. */
export const governanceSecrets = {
  erasurePseudonymSecret: Secret.load("GOVERNANCE_ERASURE_PSEUDONYM_SECRET", { optional: true }),
} as const;

/** The deployment facts governance reads: where issued personal keys send traffic. */
export const governanceConfig = Config.define(() => ({ gatewayPublicUrl, gatewayLegacyUrl }));
export type GovernanceConfig = ConfigOf<typeof governanceConfig>;

/** Main's precedence: the public URL, the legacy base URL, then the SaaS or local default. */
export function governanceGatewayBaseUrl({
  config,
  isSaas,
}: {
  config: GovernanceConfig | undefined;
  isSaas: boolean;
}): string {
  return resolveGatewayBaseUrl({
    LW_GATEWAY_PUBLIC_URL: config?.gatewayPublicUrl,
    LW_GATEWAY_BASE_URL: config?.gatewayLegacyUrl,
    IS_SAAS: isSaas,
  });
}
