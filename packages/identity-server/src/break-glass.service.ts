import {
  type BreakGlassBinding,
  BREAK_GLASS_WARNING_DAYS,
  breakGlassDaysRemaining,
  breakGlassIsLive,
  breakGlassWarningsDue,
  SsoBreakGlassLastWayInError,
} from "@langwatch/identity";
import type { SsoBreakGlassBindingRepository } from "./sso-connection.repository";
import type {
  SsoBreakGlassRepository,
  SsoBreakGlassWarningNotifier,
} from "./break-glass.repository";

/**
 * The way back in, as a write surface (D05).
 *
 * Three verbs and one read, and the read is the one activation already asks:
 * this class IS the `SsoBreakGlassBindingRepository` the connection guards
 * were built against, so the port D04 shipped with the weakest honest answer
 * now answers from real bindings and no guard, command or test had to change
 * to start enforcing them.
 *
 * A renewal is an INSERT rather than an update, deliberately. What makes a
 * renewal auditable is that the previous end date is still there afterwards:
 * "who granted it, to whom, and until when" is a fact, and a fact that a
 * later action overwrites is not one. So each row is immutable except for
 * `supersededAt` (written once, by the renewal that replaced it) and
 * `warnedDays` (what has already been said about it).
 *
 * Expiry needs nobody. A binding stops being a way in because
 * `breakGlassIsLive` compares two numbers, not because a job ran — so an
 * installation whose worker was down over a weekend still has an expiry that
 * happened on the date it said it would. The sweep exists only to WARN, and
 * a warning that arrives late is a late warning rather than an access
 * decision nobody made.
 */
export interface SsoBreakGlassServiceDeps {
  bindings: SsoBreakGlassRepository;
  notifier: SsoBreakGlassWarningNotifier;
  newBindingId: () => string;
  /**
   * Whether this organization's sign-in is currently decided by an ACTIVE
   * connection. Revoking the last live way back in is refused exactly while
   * this answers true: the one lever that exists for the identity provider
   * failing must not be removable while the identity provider is in charge.
   * A closure over the connection projection, answered by the composition
   * root — this service never reads connections itself.
   */
  organizationHasActiveConnection: (args: {
    organizationId: string;
  }) => Promise<boolean>;
  now?: () => number;
}

export class SsoBreakGlassService implements SsoBreakGlassBindingRepository {
  private readonly now: () => number;

  constructor(private readonly deps: SsoBreakGlassServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Grant somebody a way in, with the date it ends. Never self-served: the
   * grantor is recorded separately from the holder, so a lockout
   * post-mortem can always say who decided that this person would be the one
   * still able to get in.
   */
  async grant({
    organizationId,
    userId,
    grantedByUserId,
    expiresAtMs,
  }: {
    organizationId: string;
    userId: string;
    grantedByUserId: string;
    expiresAtMs: number;
  }): Promise<BreakGlassBinding> {
    const binding: BreakGlassBinding = {
      bindingId: this.deps.newBindingId(),
      organizationId,
      userId,
      grantedByUserId,
      grantedAtMs: this.now(),
      expiresAtMs,
      supersededAtMs: null,
      renewedFromBindingId: null,
      warnedDays: [],
    };
    await this.deps.bindings.create({ binding });
    return binding;
  }

  /**
   * Extend a way in by writing a new one that names the old.
   *
   * The renewal carries the grantor again, because renewing is a decision of
   * the same weight as granting: somebody is choosing that this person keeps
   * a door the rest of the organization does not have. The row it replaces
   * is marked superseded and stays exactly as it was, which is where "the
   * date it previously ended is still readable" lives.
   */
  async renew({
    bindingId,
    organizationId,
    grantedByUserId,
    expiresAtMs,
  }: {
    bindingId: string;
    organizationId: string;
    grantedByUserId: string;
    expiresAtMs: number;
  }): Promise<{ renewed: BreakGlassBinding; replaced: BreakGlassBinding }> {
    const replaced = await this.deps.bindings.findById({ bindingId });
    if (!replaced || replaced.organizationId !== organizationId) {
      // Not a handled refusal: a renewal names a binding the surface just
      // listed, so a miss here is a caller defect or a race with a delete,
      // and neither is something the reader can act on.
      throw new Error(
        `break-glass binding ${bindingId} is not one of organization ${organizationId}'s`,
      );
    }
    const now = this.now();
    const renewed: BreakGlassBinding = {
      bindingId: this.deps.newBindingId(),
      organizationId,
      userId: replaced.userId,
      grantedByUserId,
      grantedAtMs: now,
      expiresAtMs,
      supersededAtMs: null,
      renewedFromBindingId: replaced.bindingId,
      warnedDays: [],
    };
    await this.deps.bindings.create({ binding: renewed });
    await this.deps.bindings.markSuperseded({
      bindingId: replaced.bindingId,
      supersededAtMs: now,
    });
    return { renewed, replaced };
  }

  /**
   * End a grant now, on purpose. The row survives with its end written on
   * it — a revocation is auditable for the same reason a renewal is, so this
   * reuses the one mutation rows allow (`supersededAt`) rather than a
   * delete.
   *
   * Refused when it would leave an ACTIVE connection with no live way back
   * in: that grant is the lockout lever, and the moment the identity
   * provider decides sign-in is exactly the moment the lever must exist.
   * Grant somebody else first, or remove the connection itself.
   */
  async revoke({
    bindingId,
    organizationId,
  }: {
    bindingId: string;
    organizationId: string;
  }): Promise<BreakGlassBinding> {
    const binding = await this.deps.bindings.findById({ bindingId });
    if (!binding || binding.organizationId !== organizationId) {
      // Not a handled refusal: a revocation names a binding the surface just
      // listed, so a miss is a caller defect or a race, and neither is
      // something the reader can act on.
      throw new Error(
        `break-glass binding ${bindingId} is not one of organization ${organizationId}'s`,
      );
    }
    const nowMs = this.now();
    // Already ended — by expiry, renewal or an earlier revocation. Ending it
    // again changes nothing, so it answers as if it just had.
    if (!breakGlassIsLive({ binding, nowMs })) return binding;

    if (
      await this.deps.organizationHasActiveConnection({ organizationId })
    ) {
      const otherWaysIn = (await this.live({ organizationId })).filter(
        (candidate) => candidate.bindingId !== bindingId,
      );
      if (otherWaysIn.length === 0) {
        throw new SsoBreakGlassLastWayInError(
          `binding ${bindingId} is organization ${organizationId}'s only live way back in while a connection is ACTIVE`,
        );
      }
    }

    await this.deps.bindings.markSuperseded({
      bindingId,
      supersededAtMs: nowMs,
    });
    return { ...binding, supersededAtMs: nowMs };
  }

  /** Every binding an organization has held, so the history reads whole. */
  async history({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    return this.deps.bindings.findAllForOrganization({ organizationId });
  }

  /** The bindings that are a way in right now. */
  async live({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    const nowMs = this.now();
    const held = await this.deps.bindings.findAllForOrganization({
      organizationId,
    });
    return held.filter((binding) => breakGlassIsLive({ binding, nowMs }));
  }

  /** Activation's precondition, asked of the bindings themselves. */
  async hasLiveBinding({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<boolean> {
    return (await this.live({ organizationId })).length > 0;
  }

  /**
   * Tell whoever can renew a binding that it is ending, at fourteen, seven
   * and one day. Each mark is sent once; a sweep that missed one still sends
   * it, because the question is which marks the binding has passed rather
   * than which one is exactly today.
   */
  async sweepWarnings({ limit = 200 }: { limit?: number } = {}): Promise<{
    warned: number;
  }> {
    const nowMs = this.now();
    const horizonMs =
      nowMs + Math.max(...BREAK_GLASS_WARNING_DAYS) * 24 * 60 * 60 * 1000;
    const expiring = await this.deps.bindings.findLiveExpiringBefore({
      beforeMs: horizonMs,
      nowMs,
      limit,
    });
    let warned = 0;
    for (const binding of expiring) {
      const due = breakGlassWarningsDue({ binding, nowMs });
      if (due.length === 0) continue;
      // The number the reader is told is the number of days actually left,
      // not the mark that tripped: a warning saying "seven days" on the day
      // five remain is a warning that lies about a date.
      const daysRemaining = breakGlassDaysRemaining({ binding, nowMs });
      await this.deps.notifier.warn({ binding, daysRemaining });
      await this.deps.bindings.recordWarningsSent({
        bindingId: binding.bindingId,
        days: due,
      });
      warned += 1;
    }
    return { warned };
  }
}
