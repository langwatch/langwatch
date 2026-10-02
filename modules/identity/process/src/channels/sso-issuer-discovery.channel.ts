/**
 * Whether an issuer answers as one. Two answers, not the proof's three:
 * "unreachable" and "not a provider" both stop the registration, and the
 * reason is what says which.
 */
export type SsoIssuerDiscovery =
  /** `issuer` is the one the discovery document names, when it names one;
   *  `endpoints` are the endpoint addresses it lists. */
  { reachable: true; issuer?: string; endpoints?: string[] } | { reachable: false; reason: string };

/**
 * Asking an issuer whether it is one: at registration, so a mistyped address is
 * a sentence on the screen rather than a later failed redirect, and before a
 * sign-in, to read which origins the issuer's endpoints live on.
 */
export interface SsoIssuerDiscoveryChannel {
  discover(args: { issuer: string }): Promise<SsoIssuerDiscovery>;
}
