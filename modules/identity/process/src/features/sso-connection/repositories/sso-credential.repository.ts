import type { SsoCredentialKind } from "@langwatch/identity-contract";

/**
 * What the vault answered. A union rather than a nullable value: "no such
 * credential" is a fact the caller acts on — the connection cannot be
 * dialled — and not a failure it should have to tell from one.
 */
export type SsoCredentialRead = { found: true; value: string } | { found: false };

/**
 * The vault a connection's credential references point at (D09). Two verbs
 * and no update: rotating mints a NEW reference in a NEW fact, which is what
 * makes "when did this secret change" answerable from a log holding none.
 */
export abstract class SsoCredentialRepository {
  /** Keep a value and answer the reference to it. The reference is what
   *  goes in the command, and therefore in the fact. */
  abstract put(args: {
    organizationId: string;
    connectionId: string;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string>;

  /**
   * Read one back. Scoped by organization as well as by reference: a
   * reference is an opaque id, and an id being hard to guess is not an
   * access rule.
   */
  abstract read(args: { organizationId: string; ref: string }): Promise<SsoCredentialRead>;
}
