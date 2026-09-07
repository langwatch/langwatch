/**
 * The thing an SSO connection's credential references point AT (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * The aggregate has carried `clientIdRef`, `secretRef` and `certRefs` since
 * D04 and has never carried a value, because a fact may not carry a secret
 * (ADR-101 §4). What was missing was the other end of the reference. This is
 * the port for it; the encryption and the table are the app's.
 *
 * Two verbs and no update. A credential is written once, at the moment a
 * command mints a reference for it, and rotating one mints a NEW reference in
 * a NEW fact — which is what makes "when did this organization's client
 * secret change" answerable from the log without the log ever holding one.
 */

/** What a stored value IS, so a reader never has to guess how to parse it. */
export const SSO_CREDENTIAL_KINDS = [
  "oidc-client-id",
  "oidc-client-secret",
  /** The whole SAML dialing configuration as one JSON document: the sign-in
   *  address, the entity id, and whichever of metadata / certificate the
   *  administrator supplied. One record rather than three because they are
   *  read together or not at all, and a half-populated SAML provider is not
   *  a thing the engine can dial. */
  "saml-idp-config",
] as const;

export type SsoCredentialKind = (typeof SSO_CREDENTIAL_KINDS)[number];

export interface SsoCredentialStore {
  /**
   * Keep a value and answer the reference to it. The reference is what goes
   * in the command, and therefore in the fact.
   */
  put(args: {
    organizationId: string;
    connectionId: string;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string>;

  /**
   * Read one back. Scoped by organization as well as by reference: a
   * reference is an opaque id and this is the only place that could ever be
   * asked for somebody else's, so it refuses rather than trusting the id to
   * be unguessable.
   */
  read(args: {
    organizationId: string;
    ref: string;
  }): Promise<string | null>;
}
