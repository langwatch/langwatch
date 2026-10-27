import type { BreakGlassBinding } from "@langwatch/identity-contract";

/**
 * Where the ways back in are kept (D05). Rows are immutable except for
 * `supersededAt` and `warnedDays`: a renewal INSERTs, which is what keeps a
 * previous end date readable after somebody moved it.
 */
export abstract class SsoBreakGlassRepository {
  /** Every binding an organization has ever held, oldest first. */
  abstract findAllForOrganization(args: { organizationId: string }): Promise<BreakGlassBinding[]>;

  abstract findById(args: { bindingId: string }): Promise<BreakGlassBinding | null>;

  abstract create(args: { binding: BreakGlassBinding }): Promise<void>;

  /** Mark one row replaced. Only ever called with the row a renewal names. */
  abstract markSuperseded(args: { bindingId: string; supersededAtMs: number }): Promise<void>;

  /** Atomically ends one binding without letting concurrent revocations
   *  remove the final recovery path. */
  abstract revokePreservingRecovery(args: {
    bindingId: string;
    organizationId: string;
    nowMs: number;
  }): Promise<BreakGlassBinding>;

  /**
   * Reserve the organization's current recovery path until the matching
   * activation fact is projected. Repeating the same command is idempotent.
   */
  abstract reserveActivationRecovery(args: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean>;

  /** Record that a warning was sent, so a second sweep the same day is silent. */
  abstract recordWarningsSent(args: { bindingId: string; days: number[] }): Promise<void>;

  /**
   * Live bindings across every organization whose expiry is close enough that
   * the sweep may have something to say. Cross-organization by nature — the
   * sweep serves the whole installation — and the one read on this port that is.
   */
  abstract findLiveExpiringBefore(args: {
    beforeMs: number;
    nowMs: number;
    limit: number;
  }): Promise<BreakGlassBinding[]>;
}
