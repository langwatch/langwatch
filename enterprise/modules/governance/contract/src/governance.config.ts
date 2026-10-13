// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What this feature is configured with, and the secret handles it resolves.
 * The process parses the schema once and hands the result down; a secret is
 * resolved only through its handle, never read from `process.env`.
 */
import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  gatewayAddressOf,
  gatewayInternalUrl,
  gatewayLegacyUrl,
  gatewayPublicUrl,
  isSaas,
  publicBaseUrl,
  type ConfigOf,
} from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { gatewayInternalSecret, virtualKeyPepper } from "@langwatch/secrets/shared-secrets";
import { z } from "zod";

/** A vendor base that is unset or blank reads as the real vendor; a value that is set must be a URL. */
const optionalVendorBase = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

/** Every stored erasure digest is a function of this value: set it once, never change it. */
export const governanceSecrets = {
  erasurePseudonymSecret: Secret.load("GOVERNANCE_ERASURE_PSEUDONYM_SECRET", { optional: true }),
  /** Prefixed into an ingestion secret's hash, so a database-only leak is inert. */
  ingestionSecretPepper: virtualKeyPepper,
  /** Signs OTTL validate and transform calls to the gateway's internal surface. */
  ottlSigningSecret: gatewayInternalSecret,
} as const;

/** Where issued personal keys send traffic, where OTTL calls reach the gateway, the ingest throttle and this deployment's origin. */
export const governanceConfig = Config.define((c) => ({
  gatewayPublicUrl,
  gatewayInternalUrl,
  gatewayLegacyUrl,
  /** The address fence a pull source's fetch is judged by, as main's pullers read it. */
  blockLocalHttpCalls,
  allowedProxyHosts,
  /** Where each pulled vendor is reached; unset or blank is the vendor itself, haven's +outbound names outboundsim. */
  openAiAdminApiBase: c.env("OPENAI_ADMIN_API_BASE", optionalVendorBase),
  anthropicAdminApiBase: c.env("ANTHROPIC_ADMIN_API_BASE", optionalVendorBase),
  microsoftLoginBase: c.env("MICROSOFT_LOGIN_BASE", optionalVendorBase),
  microsoftGraphApiBase: c.env("MICROSOFT_GRAPH_API_BASE", optionalVendorBase),
  /** The one Databricks workspace origin accepted beside the three vendor clouds. */
  databricksWorkspaceBase: c.env("DATABRICKS_WORKSPACE_BASE", optionalVendorBase),
  /** The one Dataverse environment address accepted beside the real Dynamics clouds. */
  dataverseEnvironmentBase: c.env("DATAVERSE_ENVIRONMENT_BASE", optionalVendorBase),
  /** The hosted product, whose default gateway is the SaaS one rather than the local one. */
  isSaas,
  /** This deployment's public origin (`BASE_HOST`), absent where it named none; the CLI's links lead back to it. */
  publicBaseUrl,
  /** Main's `LW_INGEST_RATE_LIMIT_DISABLED=1`: tests and dev switch the push receivers' throttle off. */
  ingestRateLimitDisabled: c.env(
    "LW_INGEST_RATE_LIMIT_DISABLED",
    z
      .string()
      .optional()
      .transform((value) => value === "1"),
  ),
}));
export type GovernanceConfig = ConfigOf<typeof governanceConfig>;

/** Main's precedence: the public URL, the legacy base URL, then the SaaS or local default. */
export function governanceGatewayBaseUrl({
  config,
}: {
  config: GovernanceConfig | undefined;
}): string {
  return gatewayAddressOf({
    publicUrl: config?.gatewayPublicUrl,
    legacyUrl: config?.gatewayLegacyUrl,
    isSaas: config?.isSaas ?? false,
  });
}
