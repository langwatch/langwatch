/**
 * The identity this install presents to LangWatch, and what it remembers about
 * its own reporting. One row: two processes starting at once race on the fixed
 * primary key rather than minting two identities (ADR-156, section 6).
 */

import type { Instant } from "@langwatch/time";

/** The whole row, for a caller that needs more than the id. */
export interface InstanceIdentityRecord {
  readonly instanceId: string;
  readonly createdAt: Instant;
  readonly lastReportAt: Instant | null;
  readonly lastReportError: string | null;
  readonly optionalMetricsOptOut: boolean;
  readonly hostnameOptOut: boolean;
}

/** What a customer switched off. Absent means the switch is left alone. */
export interface InstanceReportSwitches {
  readonly optionalMetricsOptOut?: boolean;
  readonly hostnameOptOut?: boolean;
}

export interface InstanceIdentityRepository {
  /** The row as it stands, or null where this install never minted one. */
  findRow(): Promise<InstanceIdentityRecord | null>;

  /**
   * Mints the identity, or answers the one a racing process already minted.
   * Never returns a second identity for one install.
   */
  mint(instanceId: string): Promise<InstanceIdentityRecord>;

  /**
   * Records what a customer switched off, creating the one row under
   * `instanceIdIfMissing` when none exists yet. Never a second row.
   */
  setReportSwitches(params: {
    switches: InstanceReportSwitches;
    instanceIdIfMissing: string;
  }): Promise<void>;

  /**
   * Records how the last report went, creating the row as above. A refused
   * report is written down rather than logged and forgotten.
   */
  recordReport(params: {
    error: string | null;
    at: Instant;
    instanceIdIfMissing: string;
  }): Promise<void>;
}
