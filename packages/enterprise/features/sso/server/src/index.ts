export {
  PostgresSsoAdapter,
  type PostgresSsoAdapterOptions,
} from "./adapters/postgres.postgres.adapter";
export type { SsoDatabase } from "./ports/sso-database.port";
export {
  SsoGateLogger,
  SsoGateService,
  SsoProviderMountInspector,
  type SsoGateServiceOptions,
  type SsoLicenseInspection,
  SsoLicenseRepository,
  SsoLicenseVerifier,
} from "./services/sso-gate.service";
export {
  BetterAuthSsoAdapter,
  LEGACY_CALLBACK_PROVIDER_IDS,
  PLAIN_OIDC_PROVIDERS,
  buildGenericOAuthConfigs,
  buildSocialProviders,
  discoveryUrlFor,
  fallbackName,
  isSamlSub,
  legacyCallbackUrl,
  oidcProviderConfig,
  parseIssuerUrl,
} from "./adapters/better-auth.better-auth.adapter";
