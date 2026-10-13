/**
 * The domain-ownership rows as a function of the connection heads: the fold
 * writes them with each head, and this re-derives them for a head folded
 * before it did. The rule is the fold's (`ownedVerifiedDomains`).
 */
export abstract class SsoDomainOwnershipRepository {
  abstract findConnectionIds(args: { organizationId: string }): Promise<string[]>;
  /** Throws when another organization's connection already holds one of its domains. */
  abstract reproject(args: { connectionId: string }): Promise<void>;
}
