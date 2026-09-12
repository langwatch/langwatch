import type { SignInMethod } from "@langwatch/identity";

/**
 * What a sign-in method is called on screen.
 *
 * A federated method's id is what the deployment dials, which is an operator's
 * word rather than a customer's: `oidc`, `auth0` and `azure-ad` all mean "the
 * way my company signs me in". Known consumer identities keep their own name,
 * because that is the button a person is looking for; everything else reads as
 * single sign-on, which is the only thing about it the reader can act on.
 */
const FEDERATED_METHOD_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  gitlab: "GitLab",
  "azure-ad": "Microsoft",
  microsoft: "Microsoft",
  okta: "Okta",
  cognito: "Amazon Cognito",
  onelogin: "OneLogin",
};

const SINGLE_SIGN_ON = "single sign-on";

export function signInMethodLabel(method: SignInMethod): string {
  if (method.kind === "password") return "email and password";
  if (method.kind === "passkey") return "a passkey";
  return FEDERATED_METHOD_LABELS[method.id] ?? SINGLE_SIGN_ON;
}

/** The button a method gets in the picker. */
export function signInMethodActionLabel(method: SignInMethod): string {
  return `Continue with ${signInMethodLabel(method)}`;
}
