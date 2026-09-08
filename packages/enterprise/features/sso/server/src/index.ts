export { ssoServer } from "./sso.server.ts";
export { ssoConnectionTrpcTransport } from "./transport/sso-connection.trpc.ts";
export type { SsoInfrastructure } from "./app/sso.app.ts";
export {
  SsoConnectionLedgerPort,
  type SsoConnectionLedgerOperator,
  type SsoConnectionTeardownRequest,
} from "./ports/sso-connection-ledger.port.ts";
export { SsoGateLoggerPort } from "./ports/sso-gate-logger.port.ts";
export { SsoProviderMountInspector } from "./services/sso-gate.service.ts";
export {
  BetterAuthSsoAdapter,
  BetterAuthSsoProviderMount,
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
} from "./adapters/better-auth.better-auth.adapter.ts";
