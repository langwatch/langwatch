import type { BreakGlassBinding } from "@langwatch/identity";

/**
 * Where the ways back in are kept (D05). The app implements this with Prisma
 * over `SsoBreakGlassBinding`
 * (platform/app/src/server/app-layer/identity/repositories/sso-break-glass.prisma.repository.ts).
 *
 * Rows are immutable except for the two fields that are not the grant
 * itself: `supersededAt`, written once when a renewal replaces a row, and
 * `warnedDays`, which records what has already been said. A renewal is an
 * INSERT, which is what keeps the date a way in previously ended readable
 * after somebody moved it.
 */
export interface SsoBreakGlassRepository {
  /** Every binding an organization has ever held, oldest first. */
  findAllForOrganization(args: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]>;

  findById(args: { bindingId: string }): Promise<BreakGlassBinding | null>;

  create(args: { binding: BreakGlassBinding }): Promise<void>;

  /** Mark one row replaced. Only ever called with the row a renewal names. */
  markSuperseded(args: {
    bindingId: string;
    supersededAtMs: number;
  }): Promise<void>;

  /** Record that a warning was sent, so a second sweep the same day is silent. */
  recordWarningsSent(args: {
    bindingId: string;
    days: number[];
  }): Promise<void>;

  /**
   * Live bindings across every organization whose expiry is close enough that
   * the sweep may have something to say. Cross-organization by nature — the
   * sweep serves the whole installation — and the one read on this port that
   * is.
   */
  findLiveExpiringBefore(args: {
    beforeMs: number;
    nowMs: number;
    limit: number;
  }): Promise<BreakGlassBinding[]>;
}

/**
 * Who is told a way back in is ending. A port rather than a mailer call so
 * the sweep says WHAT is due and the app decides how it reaches somebody —
 * the same split the identity email service already makes.
 */
export interface SsoBreakGlassWarningNotifier {
  warn(args: {
    binding: BreakGlassBinding;
    /** How many days remain: fourteen, seven or one. */
    daysRemaining: number;
  }): Promise<void>;
}
