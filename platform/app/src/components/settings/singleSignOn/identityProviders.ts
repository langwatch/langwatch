/**
 * The identity providers an administrator recognises, and the protocols they
 * recognise instead.
 *
 * THE LIST ANSWERS TWO DIFFERENT READERS. Most people sent here know their
 * company runs Okta long before they know whether the thing Okta exports is
 * called OIDC or SAML, so recognition by NAME comes first. But a security
 * engineer arriving with a metadata file in hand knows exactly which protocol
 * they have and does not want to pick a brand to get to it — and until now
 * the only way through for them was "Something else", which reads like a
 * consolation prize for an unsupported product. OpenID Connect and SAML are
 * therefore first-class tiles of their own, in a second group, and a genuinely
 * unlisted provider still has its own way in below them.
 *
 * LOGOS WHERE THEY EXIST, LETTERS WHERE THEY DO NOT. A brand is recognised in
 * a fraction of the time its name is read, which is the entire reason to show
 * a grid rather than a dropdown. Where the icon set has no mark for a product
 * we draw its initials instead of inventing a logo — the tile still works, and
 * we have not put words in a company's mouth.
 *
 * Everything here is display metadata. Nothing about the connection itself
 * depends on which tile was picked: the server sees only the protocol and
 * the credentials.
 */

import type { IconType } from "react-icons";
import { FaMicrosoft } from "react-icons/fa6";
import { LuFileCode2, LuShieldQuestion } from "react-icons/lu";
import { SiAuth0, SiGoogle, SiKeycloak, SiOkta, SiOpenid } from "react-icons/si";

export type SsoProtocol = "oidc" | "saml";

/** Which half of the picker a tile belongs to. */
export type IdentityProviderGroup = "product" | "protocol";

export interface IdentityProviderPreset {
  id: string;
  name: string;
  group: IdentityProviderGroup;
  /** The product's own mark, where the icon set carries one. */
  icon: IconType | null;
  /** Initials, used only when there is no mark — honest, not a fake logo. */
  monogram: string;
  defaultProtocol: SsoProtocol;
  /** Where in the provider's console the app is created, in the console's
   *  own menu words. Null when we have no console to point at. */
  consolePath: string | null;
  /** Protocol-specific examples in the provider's own address shapes, so a
   *  placeholder confirms the administrator is pasting the right thing. */
  issuerExample: string;
  entryPointExample: string;
  /** Whether the protocol cards stay on screen after this tile is picked.
   *  A tile that IS a protocol has already answered that question. */
  protocolIsChosen: boolean;
}

export const IDENTITY_PROVIDER_PRESETS: IdentityProviderPreset[] = [
  {
    id: "okta",
    name: "Okta",
    group: "product",
    icon: SiOkta,
    monogram: "Ok",
    defaultProtocol: "oidc",
    consolePath: "Applications → Create App Integration",
    issuerExample: "https://acme.okta.com",
    entryPointExample: "https://acme.okta.com/app/…/sso/saml",
    protocolIsChosen: false,
  },
  {
    id: "entra",
    name: "Microsoft Entra ID",
    group: "product",
    icon: FaMicrosoft,
    monogram: "En",
    defaultProtocol: "oidc",
    consolePath: "Enterprise applications → New application",
    issuerExample: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    entryPointExample: "https://login.microsoftonline.com/<tenant-id>/saml2",
    protocolIsChosen: false,
  },
  {
    id: "google",
    name: "Google Workspace",
    group: "product",
    icon: SiGoogle,
    monogram: "Go",
    defaultProtocol: "saml",
    consolePath: "Admin console → Apps → Web and mobile apps",
    issuerExample: "https://accounts.google.com",
    entryPointExample: "https://accounts.google.com/o/saml2/idp?idpid=…",
    protocolIsChosen: false,
  },
  {
    id: "onelogin",
    name: "OneLogin",
    group: "product",
    // Simple Icons carries no OneLogin mark, so the tile keeps its letters.
    icon: null,
    monogram: "Ol",
    defaultProtocol: "oidc",
    consolePath: "Applications → Add App",
    issuerExample: "https://acme.onelogin.com/oidc/2",
    entryPointExample: "https://acme.onelogin.com/trust/saml2/http-post/sso/…",
    protocolIsChosen: false,
  },
  {
    id: "jumpcloud",
    name: "JumpCloud",
    group: "product",
    icon: null,
    monogram: "Jc",
    defaultProtocol: "saml",
    consolePath: "SSO Applications → Add New Application",
    issuerExample: "https://oauth.id.jumpcloud.com",
    entryPointExample: "https://sso.jumpcloud.com/saml2/acme",
    protocolIsChosen: false,
  },
  {
    id: "keycloak",
    name: "Keycloak",
    group: "product",
    icon: SiKeycloak,
    monogram: "Kc",
    defaultProtocol: "oidc",
    consolePath: "Clients → Create client",
    issuerExample: "https://sso.acme.com/realms/acme",
    entryPointExample: "https://sso.acme.com/realms/acme/protocol/saml",
    protocolIsChosen: false,
  },
  {
    id: "auth0",
    name: "Auth0",
    group: "product",
    icon: SiAuth0,
    monogram: "A0",
    defaultProtocol: "oidc",
    consolePath: "Applications → Create Application",
    issuerExample: "https://acme.eu.auth0.com",
    entryPointExample: "https://acme.eu.auth0.com/samlp/…",
    protocolIsChosen: false,
  },

  // The reader who came with a protocol rather than a product.
  {
    id: "oidc",
    name: "OpenID Connect",
    group: "protocol",
    icon: SiOpenid,
    monogram: "ID",
    defaultProtocol: "oidc",
    consolePath: null,
    issuerExample: "https://sso.acme.com",
    entryPointExample: "Where your identity provider signs people in",
    protocolIsChosen: true,
  },
  {
    id: "saml",
    name: "SAML",
    group: "protocol",
    icon: LuFileCode2,
    monogram: "SA",
    defaultProtocol: "saml",
    consolePath: null,
    issuerExample: "https://sso.acme.com",
    entryPointExample: "https://sso.acme.com/saml2/sso",
    protocolIsChosen: true,
  },
  {
    id: "other",
    name: "Something else",
    group: "protocol",
    icon: LuShieldQuestion,
    monogram: "?",
    defaultProtocol: "oidc",
    consolePath: null,
    issuerExample: "https://sso.acme.com",
    entryPointExample: "Where your identity provider signs people in",
    protocolIsChosen: false,
  },
];

export function identityProviderPreset(id: string): IdentityProviderPreset {
  const preset = IDENTITY_PROVIDER_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`unknown identity provider preset: ${id}`);
  return preset;
}

export function identityProvidersIn(
  group: IdentityProviderGroup,
): IdentityProviderPreset[] {
  return IDENTITY_PROVIDER_PRESETS.filter((entry) => entry.group === group);
}
