import { parseSignInIdpKind, type SignInIdpKind } from "./refused-sign-in.ts";

/** The product name a person knows their company sign-in by; protocols name nothing useful. */
export const SIGN_IN_IDP_NAMES: Readonly<Record<SignInIdpKind, string | undefined>> = {
  okta: "Okta",
  entra: "Microsoft Entra ID",
  google: "Google Workspace",
  onelogin: "OneLogin",
  jumpcloud: "JumpCloud",
  ping: "Ping Identity",
  auth0: "Auth0",
  oidc: undefined,
  saml: undefined,
};

/** The name shown for a caller-controlled `idp`, or undefined when it names none we admit. */
export function describeSignInIdp(value: string | null | undefined): string | undefined {
  const kind = parseSignInIdpKind(value);
  return kind ? SIGN_IN_IDP_NAMES[kind] : undefined;
}
