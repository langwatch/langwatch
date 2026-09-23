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
  readonly startupNoticeAcknowledgedSchemaVersion: number;
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

  /** Records that an administrator read the startup notice for this version. */
  acknowledgeStartupNotice(params: { instanceId: string; schemaVersion: number }): Promise<void>;

  /**
   * Records what a customer switched off. An install with no identity has
   * nothing to write to, and would be writing the defaults anyway.
   */
  setReportSwitches(switches: InstanceReportSwitches): Promise<void>;

  /**
   * Records how the last report went. A refused report is written down rather
   * than logged and forgotten, so an install whose reports are being rejected
   * stops looking healthy from both sides.
   */
  recordReport(params: { error: string | null; at: Instant }): Promise<void>;
}
