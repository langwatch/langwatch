import type { SsoConnectionLifecycleState, SsoConnectionType } from "./connection.ts";

/**
 * What happened to one connection, as a reader reads it (ADR-117 §5, D05).
 * The organization's own authentication page and the back office render the
 * same lines, because they are the same facts.
 */

/**
 * How many entries a history panel shows. A connection's lifetime carries a
 * few dozen facts at most — headroom, not a page size anyone clicks past.
 */
export const SSO_CONNECTION_HISTORY_LIMIT = 200;

/** One line of the history, as either surface renders it. */
export interface SsoConnectionHistoryEntryView {
  /** The event this line IS, so a re-render cannot reorder or duplicate it. */
  eventId: string;
  occurredAtMs: number;
  summary: string;
  /** True when the grandfather migration produced this fact from an existing
   *  legacy configuration, rather than a human acting on this connection. */
  carriedOver: boolean;
}

/**
 * One of an organization's SSO connections, as a peer module is answered.
 * Identity owns these rows; nobody else queries them (the SCIM ruling).
 */
export interface OrganizationSsoConnection {
  connectionId: string;
  /**
   * The word an administrator reads on the card. Until a connection carries a
   * name of its own, that is the provider id registration collected.
   */
  displayName: string;
  /** Which protocol this connection speaks, as identity recorded it at
   *  registration: the word a card shows beside the name. */
  type: SsoConnectionType;
  state: SsoConnectionLifecycleState;
}
