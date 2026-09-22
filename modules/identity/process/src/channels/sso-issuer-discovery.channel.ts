/**
 * Whether an issuer answers as one. Two answers, not the proof's three:
 * "unreachable" and "not a provider" both stop the registration, and the
 * reason is what says which.
 */
export type SsoIssuerDiscovery = { reachable: true } | { reachable: false; reason: string };

/**
 * Asking an issuer whether it is one. Runs once, at registration, to turn
 * "I typed the address wrong" into a sentence on the screen rather than a
 * redirect that fails later on somebody else's sign-in.
 */
export interface SsoIssuerDiscoveryChannel {
  discover(args: { issuer: string }): Promise<SsoIssuerDiscovery>;
}
