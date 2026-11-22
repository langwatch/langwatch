import type { AuthServerConfig } from "@langwatch/auth-contract";

export type SignInProvidersConfig = AuthServerConfig["signInProviders"];

/** A deployment that names no sign-in provider: every leaf unset. */
export const NO_SIGN_IN_PROVIDERS: SignInProvidersConfig = {
  authProvider: undefined,
  legacyProvider: undefined,
  googleClientId: undefined,
  githubClientId: undefined,
  gitlabClientId: undefined,
  azureAdClientId: undefined,
  azureAdTenantId: undefined,
  auth0ClientId: undefined,
  auth0Issuer: undefined,
  oktaClientId: undefined,
  oktaIssuer: undefined,
  cognitoClientId: undefined,
  cognitoIssuer: undefined,
  oneLoginClientId: undefined,
  oneLoginIssuer: undefined,
  oidcClientId: undefined,
  oidcIssuer: undefined,
};
