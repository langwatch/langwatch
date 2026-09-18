import type { SignInMethod } from "@langwatch/identity-contract";

/** Customer-facing labels for sign-in methods; unknown providers default to SSO. */
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
