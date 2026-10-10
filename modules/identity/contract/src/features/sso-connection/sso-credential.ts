/**
 * What a connection's credential references point AT (D09). The aggregate
 * carries `clientIdRef`, `secretRef` and `certRefs` and never a value — a
 * fact may not carry a secret (ADR-101 §4) — so this names the other end.
 */

/** What a stored value IS, so a reader never has to guess how to parse it. */
export const SSO_CREDENTIAL_KINDS = [
  "oidc-client-id",
  "oidc-client-secret",
  /** The whole SAML dialing configuration as one JSON document: the sign-in
   *  address, the entity id, and whichever of metadata / certificate the
   *  administrator supplied. One record because they are read together or
   *  not at all, and a half-populated SAML provider cannot be dialled. */
  "saml-idp-config",
] as const;

export type SsoCredentialKind = (typeof SSO_CREDENTIAL_KINDS)[number];
