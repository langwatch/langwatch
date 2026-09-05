import type { SsoConnectionState } from "@langwatch/identity-contract";

/** One page of the operator list, already folded into aggregate state. */
export interface SsoConnectionBackofficePage {
  states: SsoConnectionState[];
  total: number;
}

/**
 * The reads the operator back office serves its list and detail from (D05
 * tier 1).
 *
 * Reads only, and deliberately: the `SsoConnection` row is a projection of the
 * log, so a write here would be overwritten by the next fold. Every back
 * office write goes through `SsoConnectionService` instead.
 */
export interface SsoConnectionBackofficeRepository {
  /**
   * One page, newest first. `search` matches the identifiers and domains an
   * operator would have to hand: a connection id from a log line, an
   * organization id from a support thread, or the customer's domain.
   */
  findPage(args: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SsoConnectionBackofficePage>;
  /** One connection's state, or null when no row carries that id. */
  findById(args: { connectionId: string }): Promise<SsoConnectionState | null>;
  /** The display names of the organizations a page names, by id. */
  findOrganizationNames(args: { organizationIds: string[] }): Promise<Map<string, string>>;
}
