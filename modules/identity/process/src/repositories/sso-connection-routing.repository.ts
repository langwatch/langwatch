import type { RoutableConnection } from "@langwatch/identity-contract";

import type { SignInDomainRouting } from "../services/signin-router.service.ts";

/**
 * The router's domain lookup over the connection PROJECTION rather than the
 * two staff-set legacy strings its twin reads (ADR-117 §5): what it answers
 * that they cannot is lifecycle - a SUSPENDED connection, not an absent one.
 */
export abstract class SsoConnectionRoutingRepository implements SignInDomainRouting {
  /** The connection owning this domain, a migrating pair already collapsed
   *  to the side sign-in goes through. Empty when nothing owns it. */
  abstract findConnectionsForDomain(input: {
    domain: string;
  }): Promise<readonly RoutableConnection[]>;
  /** Every connection this instance could auto-redirect to with no address
   *  in hand (the self-hosted sole-connection rule). */
  abstract findActiveConnections(): Promise<readonly RoutableConnection[]>;
}
