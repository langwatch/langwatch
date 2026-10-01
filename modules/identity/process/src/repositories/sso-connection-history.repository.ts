import type { SsoConnectionEventType, SsoConnectionSource } from "@langwatch/identity-contract";

/**
 * One fact about a connection, structurally. A fact that names no domain,
 * method and so on leaves that field null; turning a `type` plus these into
 * a sentence is the copy rule's job, never a reader's.
 */
export interface SsoConnectionHistoryEntry {
  eventId: string;
  type: SsoConnectionEventType;
  occurredAtMs: number;
  /** Whether a human configured this fact or the grandfather migration
   *  produced it from an existing legacy configuration. */
  source: SsoConnectionSource;
  domain: string | null;
  /** How a domain was, or is being, proved: `dns-txt`, `license-token`,
   *  `operator-attested` or `legacy-configuration`. */
  method: string | null;
  /** The migration route a `migration_route_selected` fact names. */
  route: string | null;
  /** The arrival policy a `connection_arrival_policy_set` fact names. */
  policy: string | null;
  /** The name a `connection_renamed` fact gives the connection. */
  name: string | null;
  /** Free text an actor gave: a claim's rejection note, an attestation's note,
   *  or a suspend/teardown reason. Never a secret — the connection's own
   *  projection already carries these same words back to whoever reads it. */
  note: string | null;
  /** The connection this one replaces, on a `replacement_connection_
   *  registered` fact. */
  replacesConnectionId: string | null;
}

/**
 * A connection's history, read as a sequence (ADR-117 §5, D04). The
 * projection answers where a connection stands; this answers what happened,
 * in order — and that question is the log itself, not the head.
 */
export abstract class SsoConnectionHistoryRepository {
  /**
   * Newest first, at most `limit`. Tenancy is structural: the aggregate is
   * the connection and its tenant is the organization, so another
   * organization's connection is never found rather than filtered out.
   */
  abstract findHistory(args: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly SsoConnectionHistoryEntry[]>;
}
