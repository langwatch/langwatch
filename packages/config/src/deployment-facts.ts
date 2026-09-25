/**
 * Deployment facts several owners read (ARCHITECTURE.md §6, layer 3). Each is
 * ONE leaf, imported by instance: the parse admits a re-bound variable only
 * when every claimant holds that same leaf.
 */
import { z } from "zod";

import { Config } from "./config.ts";
import { environmentOneOrTrueSchema } from "./env-schemas.ts";

const positiveInteger = z.coerce.number().int().positive();

export const { langevalsStagingThresholdBytes, langevalsStagingTtlSeconds } = Config.define(
  (c) => ({
    /** Unset keeps every payload inline: only a Lambda-fronted langevals has a body cap. */
    langevalsStagingThresholdBytes: c.env(
      "LANGEVALS_STAGING_THRESHOLD_BYTES",
      positiveInteger.optional(),
    ),
    /** How long a staged payload's signed URL stays valid; short, so a leaked URL lapses. */
    langevalsStagingTtlSeconds: c.env(
      "LANGEVALS_STAGING_TTL_SECONDS",
      positiveInteger.default(600),
    ),
  }),
);

/** The outbound address fence every egress-making owner judges a call by. */
export const { blockLocalHttpCalls, allowedProxyHosts } = Config.define((c) => ({
  blockLocalHttpCalls: c.env("BLOCK_LOCAL_HTTP_CALLS", environmentOneOrTrueSchema),
  /** An unset allowlist is EMPTY, never a wildcard. */
  allowedProxyHosts: c.env(
    "ALLOWED_PROXY_HOSTS",
    z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter((host) => host.length > 0),
      ),
  ),
}));

/** The terminal fallback for a target that names no model; blank is not a model. */
export const { langwatchDefaultModel } = Config.define((c) => ({
  langwatchDefaultModel: c.env(
    "LANGWATCH_DEFAULT_MODEL",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
}));

/**
 * Where the AI gateway is reached, under main's names: the public URL for apps
 * outside the deployment, the internal URL for this control plane, and the
 * legacy base URL both fall back to. `isSaas` picks the default.
 */
export const { gatewayPublicUrl, gatewayInternalUrl, gatewayLegacyUrl } = Config.define((c) => ({
  gatewayPublicUrl: c.env("LW_GATEWAY_PUBLIC_URL", z.string().optional()),
  gatewayInternalUrl: c.env("LW_GATEWAY_INTERNAL_URL", z.string().optional()),
  gatewayLegacyUrl: c.env("LW_GATEWAY_BASE_URL", z.string().optional()),
}));

const publicProviderField = z.string().min(1).optional();

/**
 * The sign-in providers this deployment names, under main's names: which one
 * `AUTH_PROVIDER` selects and the public half of each registration. Read by
 * sso (whether one is mounted) and auth (which builds them).
 */
export const signInProviders = Config.define((c) => ({
  authProvider: c.env("AUTH_PROVIDER", publicProviderField),
  /** The NextAuth-era name for `AUTH_PROVIDER`: deprecated, still applied. */
  legacyProvider: c.env("NEXTAUTH_PROVIDER", publicProviderField),
  googleClientId: c.env("GOOGLE_CLIENT_ID", publicProviderField),
  githubClientId: c.env("GITHUB_CLIENT_ID", publicProviderField),
  gitlabClientId: c.env("GITLAB_CLIENT_ID", publicProviderField),
  azureAdClientId: c.env("AZURE_AD_CLIENT_ID", publicProviderField),
  azureAdTenantId: c.env("AZURE_AD_TENANT_ID", publicProviderField),
  auth0ClientId: c.env("AUTH0_CLIENT_ID", publicProviderField),
  auth0Issuer: c.env("AUTH0_ISSUER", publicProviderField),
  oktaClientId: c.env("OKTA_CLIENT_ID", publicProviderField),
  oktaIssuer: c.env("OKTA_ISSUER", publicProviderField),
  cognitoClientId: c.env("COGNITO_CLIENT_ID", publicProviderField),
  cognitoIssuer: c.env("COGNITO_ISSUER", publicProviderField),
  oneLoginClientId: c.env("ONELOGIN_CLIENT_ID", publicProviderField),
  oneLoginIssuer: c.env("ONELOGIN_ISSUER", publicProviderField),
  oidcClientId: c.env("OIDC_CLIENT_ID", publicProviderField),
  oidcIssuer: c.env("OIDC_ISSUER", publicProviderField),
}));
