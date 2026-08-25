import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import {
  LicensingSsoAdapter,
  BetterAuthSsoAdapter,
  SsoGateLogger,
  SsoProviderMountInspector,
} from "@langwatch/enterprise-sso-server";
export {
  LEGACY_CALLBACK_PROVIDER_IDS,
  PLAIN_OIDC_PROVIDERS,
  buildGenericOAuthConfigs,
  buildSocialProviders,
  legacyCallbackUrl,
} from "@langwatch/enterprise-sso-server";
import { createLogger } from "@langwatch/observability";
import { getLicenseHandler } from "~/runtime/app/licensing";

export const ssoConfiguration: SsoConfiguration = {
  isSaas:
    process.env.IS_SAAS === "1" ||
    process.env.IS_SAAS?.toLowerCase() === "true",
  provider: process.env.NEXTAUTH_PROVIDER ?? "email",
  baseUrl: process.env.VERCEL_URL ?? process.env.NEXTAUTH_URL ?? "",
  instanceLicenseKey: process.env.LANGWATCH_LICENSE_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  gitlabClientId: process.env.GITLAB_CLIENT_ID,
  gitlabClientSecret: process.env.GITLAB_CLIENT_SECRET,
  azureAdClientId: process.env.AZURE_AD_CLIENT_ID,
  azureAdClientSecret: process.env.AZURE_AD_CLIENT_SECRET,
  azureAdTenantId: process.env.AZURE_AD_TENANT_ID,
  auth0ClientId: process.env.AUTH0_CLIENT_ID,
  auth0ClientSecret: process.env.AUTH0_CLIENT_SECRET,
  auth0Issuer: process.env.AUTH0_ISSUER,
  oktaClientId: process.env.OKTA_CLIENT_ID,
  oktaClientSecret: process.env.OKTA_CLIENT_SECRET,
  oktaIssuer: process.env.OKTA_ISSUER,
  cognitoClientId: process.env.COGNITO_CLIENT_ID,
  cognitoClientSecret: process.env.COGNITO_CLIENT_SECRET,
  cognitoIssuer: process.env.COGNITO_ISSUER,
  oneLoginClientId: process.env.ONELOGIN_CLIENT_ID,
  oneLoginClientSecret: process.env.ONELOGIN_CLIENT_SECRET,
  oneLoginIssuer: process.env.ONELOGIN_ISSUER,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
  oidcIssuer: process.env.OIDC_ISSUER,
};

class AppSsoGateLogger extends SsoGateLogger {
  private readonly logger = createLogger("langwatch:sso:gate");

  info(context: object, message: string): void {
    this.logger.info(context, message);
  }

  warn(context: object, message: string): void {
    this.logger.warn(context, message);
  }
}

class AppSsoProviderMountInspector extends SsoProviderMountInspector {
  isMounted(configuration: SsoConfiguration): boolean {
    return (
      Object.keys(BetterAuthSsoAdapter.buildSocialProviders(configuration))
        .length > 0 ||
      BetterAuthSsoAdapter.buildGenericOAuthConfigs(configuration).length > 0
    );
  }
}

const gate = LicensingSsoAdapter.create({
  configuration: ssoConfiguration,
  licensing: getLicenseHandler(),
  logger: new AppSsoGateLogger(),
  providerMountInspector: new AppSsoProviderMountInspector(),
}).build();

export const platformSSOAllowed = (): Promise<boolean> => gate.platformAllowed();
export const authProviderIsMounted = (): boolean => gate.providerIsMounted();
export const resolveAuthProvider = (): Promise<string> => gate.resolveProvider();
export const __resetSsoGateForTests = (): void =>
  gate.resetMemoizedDecisionForTests();
