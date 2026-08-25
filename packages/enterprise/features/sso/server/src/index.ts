export {
  LicensingSsoAdapter,
  type LicensingSsoAdapterOptions,
} from "./adapters/licensing.sso.adapter";
export {
  SsoGateLogger,
  SsoGateService,
  SsoProviderMountInspector,
  type SsoGateServiceOptions,
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
