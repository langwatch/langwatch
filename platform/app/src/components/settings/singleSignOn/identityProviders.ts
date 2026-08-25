/**
 * The identity providers an administrator recognises by name.
 *
 * The register flow starts from this list because recognition beats
 * vocabulary: an administrator knows their company runs Okta long before
 * they know whether the thing Okta exports is called OIDC or SAML. Picking
 * a provider names the fields in that provider's own console words, points
 * at where in the console the app is created, and pre-answers the protocol
 * question — which stays visible and changeable, never silently decided.
 *
 * Everything here is display metadata. Nothing about the connection itself
 * depends on which tile was picked: the server sees only the protocol and
 * the credentials, so "Something else" is a first-class path rather than a
 * fallback.
 */

export type SsoProtocol = "oidc" | "saml";

export interface IdentityProviderPreset {
  id: string;
  name: string;
  /** One or two letters for the tile's monogram — honest, not a fake logo. */
  monogram: string;
  defaultProtocol: SsoProtocol;
  /** Where in the provider's console the app is created, in the console's
   *  own menu words. Null when we have no console to point at. */
  consolePath: string | null;
  /** Protocol-specific examples in the provider's own address shapes, so a
   *  placeholder confirms the administrator is pasting the right thing. */
  issuerExample: string;
  entryPointExample: string;
}

export const IDENTITY_PROVIDER_PRESETS: IdentityProviderPreset[] = [
  {
    id: "okta",
    name: "Okta",
    monogram: "Ok",
    defaultProtocol: "oidc",
    consolePath: "Applications → Create App Integration",
    issuerExample: "https://acme.okta.com",
    entryPointExample: "https://acme.okta.com/app/…/sso/saml",
  },
  {
    id: "entra",
    name: "Microsoft Entra ID",
    monogram: "En",
    defaultProtocol: "oidc",
    consolePath: "Enterprise applications → New application",
    issuerExample: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    entryPointExample: "https://login.microsoftonline.com/<tenant-id>/saml2",
  },
  {
    id: "google",
    name: "Google Workspace",
    monogram: "Go",
    defaultProtocol: "saml",
    consolePath: "Admin console → Apps → Web and mobile apps",
    issuerExample: "https://accounts.google.com",
    entryPointExample: "https://accounts.google.com/o/saml2/idp?idpid=…",
  },
  {
    id: "onelogin",
    name: "OneLogin",
    monogram: "Ol",
    defaultProtocol: "oidc",
    consolePath: "Applications → Add App",
    issuerExample: "https://acme.onelogin.com/oidc/2",
    entryPointExample: "https://acme.onelogin.com/trust/saml2/http-post/sso/…",
  },
  {
    id: "jumpcloud",
    name: "JumpCloud",
    monogram: "Jc",
    defaultProtocol: "saml",
    consolePath: "SSO Applications → Add New Application",
    issuerExample: "https://oauth.id.jumpcloud.com",
    entryPointExample: "https://sso.jumpcloud.com/saml2/acme",
  },
  {
    id: "keycloak",
    name: "Keycloak",
    monogram: "Kc",
    defaultProtocol: "oidc",
    consolePath: "Clients → Create client",
    issuerExample: "https://sso.acme.com/realms/acme",
    entryPointExample: "https://sso.acme.com/realms/acme/protocol/saml",
  },
  {
    id: "auth0",
    name: "Auth0",
    monogram: "A0",
    defaultProtocol: "oidc",
    consolePath: "Applications → Create Application",
    issuerExample: "https://acme.eu.auth0.com",
    entryPointExample: "https://acme.eu.auth0.com/samlp/…",
  },
  {
    id: "other",
    name: "Something else",
    monogram: "?",
    defaultProtocol: "oidc",
    consolePath: null,
    issuerExample: "https://sso.acme.com",
    entryPointExample: "Where your identity provider signs people in",
  },
];

export function identityProviderPreset(id: string): IdentityProviderPreset {
  const preset = IDENTITY_PROVIDER_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`unknown identity provider preset: ${id}`);
  return preset;
}
