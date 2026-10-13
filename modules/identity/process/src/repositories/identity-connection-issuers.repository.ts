/**
 * Which SSO connection registered which issuer, both ways. The legacy account branch needs it:
 * connection rows from before the issuer column hold a synthetic issuer, so a real one is
 * translated to the connection's providerId, and served back on rows that carry none.
 */
export abstract class IdentityConnectionIssuersRepository {
  /** Every connection registering this issuer; several is ambiguity, which answers none. */
  abstract findProviderIdsForIssuer(args: { issuer: string }): Promise<string[]>;
  /** The issuer a connection registered: one, or none for an unknown providerId. */
  abstract findRegisteredIssuers(args: { providerId: string }): Promise<string[]>;
}
