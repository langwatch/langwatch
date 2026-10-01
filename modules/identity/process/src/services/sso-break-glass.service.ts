import {
  BREAK_GLASS_MAX_WINDOW_DAYS,
  BREAK_GLASS_WARNING_DAYS,
  breakGlassDaysRemaining,
  breakGlassExpiryIsAllowed,
  breakGlassIsLive,
  breakGlassWarningsDue,
  IdentityCapabilityUnavailableError,
  SsoBreakGlassExpiryOutOfRangeError,
  SsoBreakGlassHolderIneligibleError,
  type BreakGlassBinding,
  type BreakGlassCandidateView,
  type BreakGlassGrantView,
  type SelfServeActor,
} from "@langwatch/identity-contract";

import type { SsoBreakGlassWarningChannel } from "../channels/sso-break-glass-warning.channel.ts";
import type { SsoBreakGlassRepository } from "../repositories/sso-break-glass.repository.ts";
import type { SsoBreakGlassBindingRepository } from "../repositories/sso-connection.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One person, as the module that owns membership names them (ADR-129). */
export interface SsoBreakGlassPerson {
  userId: string;
  name: string | null;
  email: string | null;
}

/**
 * Who may hold a way back in, and what everybody on a grant is called. Both
 * are the organization module's rows: identity decides, it names.
 */
export interface SsoBreakGlassDirectory {
  findAdministrators(args: { organizationId: string }): Promise<SsoBreakGlassPerson[]>;
}

export interface SsoBreakGlassServiceDeps {
  bindings: SsoBreakGlassRepository;
  /** Where an expiry warning goes. Unanswered where the process composed no
   *  gateway for it, which the sweep refuses by name on. */
  warnings?: SsoBreakGlassWarningChannel;
  newBindingId: () => string;
  /** Who a grant may name, and what everybody on one is called. */
  directory: SsoBreakGlassDirectory;
  /** Whether this person could actually use the way in: an administrator,
   *  with a door that is not the identity provider. A binding naming anybody
   *  else satisfies `hasLiveBinding` and satisfies nothing real. */
  holderIsEligible: (args: { organizationId: string; userId: string }) => Promise<boolean>;
  now?: () => number;
}

/**
 * The way back in, as a write surface (D05). This IS the
 * `SsoBreakGlassBindingRepository` the connection guards were built against.
 * A renewal INSERTs: the previous end date stays readable afterwards.
 */
export class SsoBreakGlassService implements SsoBreakGlassBindingRepository {
  static create(deps: SsoBreakGlassServiceDeps): SsoBreakGlassService {
    return new SsoBreakGlassService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoBreakGlassServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Never self-served: the grantor is recorded separately from the holder, so
   * a lockout post-mortem can say who decided this person would be the one
   * still able to get in.
   */
  async grant({
    organizationId,
    userId,
    actor,
    expiresAtMs,
  }: {
    organizationId: string;
    userId: string;
    actor: SelfServeActor;
    expiresAtMs: number;
  }): Promise<BreakGlassBinding> {
    this.requireExpiryInRange({ expiresAtMs });
    await this.requireEligibleHolder({ organizationId, userId });

    const binding: BreakGlassBinding = {
      bindingId: this.deps.newBindingId(),
      organizationId,
      userId,
      grantedByUserId: actor.userId,
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
   * Extend a way in by writing a new one that names the old. The renewal
   * carries the grantor again, because renewing is a decision of the same
   * weight, and the row it replaces stays exactly as it was.
   */
  async renew({
    bindingId,
    organizationId,
    actor,
    expiresAtMs,
  }: {
    bindingId: string;
    organizationId: string;
    actor: SelfServeActor;
    expiresAtMs: number;
  }): Promise<{ renewed: BreakGlassBinding; replaced: BreakGlassBinding }> {
    const replaced = await this.deps.bindings.findById({ bindingId });
    if (!replaced || replaced.organizationId !== organizationId) {
      // Not a handled refusal: a renewal names a binding the surface just
      // listed, so a miss is a caller defect or a race with a delete.
      throw new Error(
        `break-glass binding ${bindingId} is not one of organization ${organizationId}'s`,
      );
    }

    // The holder may have stopped being an administrator since the grant, and
    // extending past the window is how a renewal would otherwise buy the
    // permanence the grant itself was refused.
    this.requireExpiryInRange({ expiresAtMs });
    await this.requireEligibleHolder({ organizationId, userId: replaced.userId });

    const now = this.now();
    const renewed: BreakGlassBinding = {
      bindingId: this.deps.newBindingId(),
      organizationId,
      userId: replaced.userId,
      grantedByUserId: actor.userId,
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
   * End a grant on purpose. The row survives with its end written on it, and
   * the repository refuses one that would leave an ACTIVE connection with no
   * live way back in.
   */
  async revoke({
    bindingId,
    organizationId,
  }: {
    bindingId: string;
    organizationId: string;
  }): Promise<BreakGlassBinding> {
    return this.deps.bindings.revokePreservingRecovery({
      bindingId,
      organizationId,
      nowMs: this.now(),
    });
  }

  async reserveActivationRecovery(args: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    return this.deps.bindings.reserveActivationRecovery(args);
  }

  /**
   * Every grant the organization has held, with who holds each one. A read a
   * security reviewer acts on, so the people are named rather than listed as
   * ids.
   */
  async findGrants({ organizationId }: { organizationId: string }): Promise<BreakGlassGrantView[]> {
    const bindings = await this.history({ organizationId });
    const people = await this.peopleFor({ organizationId });
    const nowMs = this.now();

    return bindings.map((binding) => ({
      bindingId: binding.bindingId,
      userId: binding.userId,
      name: people.get(binding.userId)?.name ?? null,
      email: people.get(binding.userId)?.email ?? null,
      grantedByUserId: binding.grantedByUserId,
      grantedByName: people.get(binding.grantedByUserId)?.name ?? null,
      grantedAtMs: binding.grantedAtMs,
      expiresAtMs: binding.expiresAtMs,
      supersededAtMs: binding.supersededAtMs,
      live: breakGlassIsLive({ binding, nowMs }),
      daysRemaining: breakGlassDaysRemaining({ binding, nowMs }),
    }));
  }

  /** Who one can be granted to: the organization's administrators, because
   *  the grant is a decision of the same weight as being one. */
  async findCandidates({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassCandidateView[]> {
    return this.deps.directory.findAdministrators({ organizationId });
  }

  /** The names a grant is read with. An administrator who has since stopped
   *  being one reads as an unnamed id rather than disappearing. */
  private async peopleFor({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Map<string, SsoBreakGlassPerson>> {
    const people = await this.deps.directory.findAdministrators({ organizationId });

    return new Map(people.map((person) => [person.userId, person]));
  }

  /** Every binding an organization has held, so the history reads whole. */
  async history({ organizationId }: { organizationId: string }): Promise<BreakGlassBinding[]> {
    return this.deps.bindings.findAllForOrganization({ organizationId });
  }

  /** The bindings that are a way in right now. */
  async live({ organizationId }: { organizationId: string }): Promise<BreakGlassBinding[]> {
    const nowMs = this.now();
    const held = await this.deps.bindings.findAllForOrganization({ organizationId });

    return held.filter((binding) => breakGlassIsLive({ binding, nowMs }));
  }

  /** Activation's precondition, asked of the bindings themselves. */
  async hasLiveBinding({ organizationId }: { organizationId: string }): Promise<boolean> {
    return (await this.live({ organizationId })).length > 0;
  }

  /**
   * Tell whoever can renew a binding that it is ending, at fourteen, seven and
   * one day. Each mark is sent once; a sweep that missed one still sends it.
   */
  async sweepWarnings({ limit = 200 }: { limit?: number } = {}): Promise<{ warned: number }> {
    const warnings = this.deps.warnings;
    if (!warnings) throw new IdentityCapabilityUnavailableError("break-glass warning channel");

    const nowMs = this.now();
    const horizonMs = nowMs + Math.max(...BREAK_GLASS_WARNING_DAYS) * DAY_MS;
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
      // not the mark that tripped: "seven days" on the day five remain is a
      // warning that lies about a date.
      await warnings.warn({
        binding,
        daysRemaining: breakGlassDaysRemaining({ binding, nowMs }),
      });
      await this.deps.bindings.recordWarningsSent({ bindingId: binding.bindingId, days: due });
      warned += 1;
    }

    return { warned };
  }

  /** Refuses an expiry in the past or past the window: what stops a grant
   *  dated to the year 9999 living forever, and silently. */
  private requireExpiryInRange({ expiresAtMs }: { expiresAtMs: number }): void {
    if (!breakGlassExpiryIsAllowed({ expiresAtMs, nowMs: this.now() })) {
      throw new SsoBreakGlassExpiryOutOfRangeError(BREAK_GLASS_MAX_WINDOW_DAYS);
    }
  }

  private async requireEligibleHolder({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    if (await this.deps.holderIsEligible({ organizationId, userId })) return;

    throw new SsoBreakGlassHolderIneligibleError(userId);
  }
}

/**
 * Activation's precondition as of D05: a named person who holds a live
 * binding, AND a local door for it to be a way in through — a binding on an
 * installation with no local method names somebody who cannot sign in.
 */
export class RequiresLocalDoorAndBinding implements SsoBreakGlassBindingRepository {
  static create(deps: {
    localDoor: SsoBreakGlassBindingRepository;
    bindings: SsoBreakGlassBindingRepository;
  }): RequiresLocalDoorAndBinding {
    return new RequiresLocalDoorAndBinding(deps);
  }

  private constructor(
    private readonly deps: {
      localDoor: SsoBreakGlassBindingRepository;
      bindings: SsoBreakGlassBindingRepository;
    },
  ) {}

  async hasLiveBinding(args: { organizationId: string }): Promise<boolean> {
    if (!(await this.deps.localDoor.hasLiveBinding(args))) return false;

    return this.deps.bindings.hasLiveBinding(args);
  }

  async reserveActivationRecovery(args: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    if (!(await this.deps.localDoor.hasLiveBinding(args))) return false;

    return this.deps.bindings.reserveActivationRecovery(args);
  }
}
