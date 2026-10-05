/**
 * Deployment facts several owners read (ARCHITECTURE.md §6, layer 3). Each is
 * ONE leaf, imported by instance: the parse admits a re-bound variable only
 * when every claimant holds that same leaf.
 */
import { z } from "zod";

import { Config } from "./config.ts";
import { environmentExactOneSchema, environmentOneOrTrueSchema } from "./env-schemas.ts";

const positiveInteger = z.coerce.number().int().positive();

/** Whether this deployment is the hosted product; gateway's browser projection reads it too. */
export const { isSaas } = Config.define((c) => ({
  isSaas: c.env("IS_SAAS", environmentOneOrTrueSchema),
}));

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

/**
 * Dev only: haven +voice sets it so a voice provider may name a loopback stand-in (voicesim).
 * Only the literal `1` opens it; no production config sets it. Rule: isAllowedElevenLabsUrl.
 */
export const { allowLoopbackVoiceProviders } = Config.define((c) => ({
  allowLoopbackVoiceProviders: c.env(
    "VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS",
    environmentExactOneSchema,
  ),
}));

/** The platform's OTLP collector: observability exports to it, rum's switch falls back to it. */
export const { telemetryExporterEndpoint } = Config.define((c) => ({
  telemetryExporterEndpoint: c.env(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional()),
  ),
}));

/**
 * This deployment's public origin (`BASE_HOST`): the process and every module that links back
 * hold this one leaf. Absent and blank both mean "named none".
 */
export const { publicBaseUrl } = Config.define((c) => ({
  publicBaseUrl: c.env(
    "BASE_HOST",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
}));

/**
 * The NLP engine's address (`LANGWATCH_NLP_SERVICE`): the process and every module that calls
 * the engine hold this one leaf. Absent and blank both mean "named none".
 */
export const { nlpServiceUrl } = Config.define((c) => ({
  nlpServiceUrl: c.env(
    "LANGWATCH_NLP_SERVICE",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
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

export const SAAS_GATEWAY_URL = "https://gateway.langwatch.ai" as const;
export const LOCAL_GATEWAY_URL = "http://localhost:5563" as const;

/** Where apps reach the gateway: public URL, then legacy URL, then the deployment default. */
export function gatewayAddressOf({
  publicUrl,
  legacyUrl,
  isSaas,
}: {
  publicUrl: string | undefined;
  legacyUrl: string | undefined;
  isSaas: boolean;
}): string {
  return publicUrl || legacyUrl || (isSaas ? SAAS_GATEWAY_URL : LOCAL_GATEWAY_URL);
}

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

/**
 * The addresses the platform-operator seed names. The sign-up policy reads them too: on an
 * invite-only installation they are the accounts that may be created without an invitation.
 */
export const { adminEmails } = Config.define((c) => ({
  adminEmails: c.env(
    "ADMIN_EMAILS",
    z
      .string()
      .optional()
      .transform((raw) =>
        (raw ?? "")
          .split(",")
          .map((email) => email.trim())
          .filter((email) => email.length > 0),
      ),
  ),
}));

/**
 * Who may create an account (specs/auth/sign-up-restriction.feature). Organization decides with
 * them; auth tells the browser the mode. Blank reads as unset, so a templated line with no value
 * keeps the default.
 */
export const { signUpMode, signUpAllowedDomains } = Config.define((c) => ({
  /** `open` admits anybody who reaches the installation; `invite_only` admits invited addresses. */
  signUpMode: c.env(
    "SIGN_UP_MODE",
    z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["open", "invite_only"]).default("open"),
    ),
  ),
  /** Lowercased domains without a leading `@`; empty admits any domain. */
  signUpAllowedDomains: c.env(
    "SIGN_UP_ALLOWED_DOMAINS",
    z
      .string()
      .optional()
      .transform((raw) =>
        (raw ?? "")
          .split(",")
          .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
          .filter((domain) => domain.length > 0),
      ),
  ),
}));

/** Where server-side product analytics goes: shared config no module owns (Alex, 2026-09-29). */
export const { posthogKey, posthogHost } = Config.define((c) => ({
  posthogKey: c.env("POSTHOG_KEY", z.string().optional()),
  posthogHost: c.env("POSTHOG_HOST", z.string().optional()),
}));
