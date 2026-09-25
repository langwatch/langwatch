/**
 * Secrets more than one owner holds: one handle each, claimed by instance, so a
 * double claim passes only for this very handle (ARCHITECTURE.md §6, layer 3).
 */
import { Secret } from "./secret.ts";

/** The browser-session key: auth builds sessions from it, automation signs unsubscribe links. */
export const sessionSecret = Secret.load("NEXTAUTH_SECRET", { optional: true });

/** The hash pepper: gateway peppers virtual keys with it, governance its ingestion secrets. */
export const virtualKeyPepper = Secret.load("LW_VIRTUAL_KEY_PEPPER", { optional: true });

/** The platform's own OpenAI key: model-provider dispatches on it, evaluation reads it. */
export const openAiApiKey = Secret.load("OPENAI_API_KEY", { optional: true });

/** Each sign-in provider's client secret: auth mounts them, sso reports whether one mounted. */
export const signInProviderSecrets = {
  googleClientSecret: Secret.load("GOOGLE_CLIENT_SECRET", { optional: true }),
  githubClientSecret: Secret.load("GITHUB_CLIENT_SECRET", { optional: true }),
  gitlabClientSecret: Secret.load("GITLAB_CLIENT_SECRET", { optional: true }),
  azureAdClientSecret: Secret.load("AZURE_AD_CLIENT_SECRET", { optional: true }),
  auth0ClientSecret: Secret.load("AUTH0_CLIENT_SECRET", { optional: true }),
  oktaClientSecret: Secret.load("OKTA_CLIENT_SECRET", { optional: true }),
  cognitoClientSecret: Secret.load("COGNITO_CLIENT_SECRET", { optional: true }),
  oneLoginClientSecret: Secret.load("ONELOGIN_CLIENT_SECRET", { optional: true }),
  oidcClientSecret: Secret.load("OIDC_CLIENT_SECRET", { optional: true }),
} as const;
