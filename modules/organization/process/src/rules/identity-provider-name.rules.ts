/** The identity providers a person reads by name; a generic OIDC or SAML one has none. */
export const IDENTITY_PROVIDER_NAMES: Readonly<Partial<Record<string, string>>> = {
  okta: "Okta",
  entra: "Microsoft Entra ID",
  google: "Google Workspace",
  onelogin: "OneLogin",
  jumpcloud: "JumpCloud",
  ping: "Ping Identity",
  auth0: "Auth0",
};
