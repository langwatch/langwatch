/**
 * The 30-day seat hold (specs/licensing/seat-rotation.feature): what a membership write does to
 * its person's full seat, who waits for a seat, and what the remove dialog and Users list read.
 */
import { classifyMemberType, type MemberType } from "@langwatch/entitlement-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type {
  MemberSeatStanding,
  OrganizationMembershipRepository,
  WaitingMember,
} from "../repositories/organization-membership.repository.ts";
import type {
  SeatHold,
  SeatHoldReason,
  SeatHoldRepository,
  SeatTransition,
} from "../repositories/seat-hold.repository.ts";
import {
  customRoleIdsOf,
  customRolePermissionsOf,
} from "../rules/custom-role-permissions.rules.ts";
import { seatHoldOutcome } from "../rules/seat-hold.rules.ts";

/** What removing a person does to their seat, for the remove dialog. */
export type SeatRemovalPreview = Readonly<{
  /** Whether the person holds a full seat that the removal stops them holding. */
  holdsFullSeat: boolean;
  /** When the seat frees, or null when it frees at once (or there is no full seat). */
  seatFreesAt: Instant | null;
  /** Who waits longest for a full seat, offered the seat when it frees at once. */
  waiting: WaitingMember | null;
}>;

/** An organization one seat hold check failed in, retried by the next check. */
export type SeatHoldCheckFailure = Readonly<{ organizationId: string; error: string }>;

/** What one seat hold check did: who it admitted and the organizations it must retry. */
export type SeatHoldCheckOutcome = Readonly<{
  admitted: number;
  failures: readonly SeatHoldCheckFailure[];
}>;

type SeatHoldDependencies = {
  memberships: OrganizationMembershipRepository;
  holds: SeatHoldRepository;
  now?: () => Instant;
};

export class SeatHoldService {
  static create(dependencies: SeatHoldDependencies): SeatHoldService {
    return new SeatHoldService(dependencies);
  }

  private constructor(private readonly dependencies: SeatHoldDependencies) {}

  now(): Instant {
    return this.dependencies.now?.() ?? nowInstant();
  }

  /**
   * What stopping to hold a full seat leaves: a hold while the seat is under 30 days old, else
   * nothing (it frees at once). `unchanged` when the person holds no full seat to stop holding.
   */
  async releaseOf(input: {
    organizationId: string;
    userId: string;
    reason: SeatHoldReason;
  }): Promise<SeatTransition> {
    const [standing] = await this.dependencies.memberships.findSeatStandings(input);
    if (!standing || standing.disabledAt !== null) return { kind: "unchanged" };
    if (!(await this.classifiesFull({ ...input, standing }))) return { kind: "unchanged" };
    return { kind: "released", hold: this.holdOf({ ...input, standing }) };
  }

  /** The seat a membership takes as it becomes full: its live hold's date, else now. */
  async takeOf(input: { organizationId: string; userId: string }): Promise<SeatTransition> {
    const [hold] = await this.findLiveHolds(input);
    return { kind: "taken", since: hold?.seatTakenAt ?? this.now() };
  }

  /** The person's holds that have not ended, the user id match before the address match. */
  findLiveHolds(input: {
    organizationId: string;
    userId?: string;
    email?: string;
  }): Promise<SeatHold[]> {
    return this.dependencies.holds.findLiveForPerson({ ...input, now: this.now() });
  }

  /** Whether the person still has a hold that has not ended. */
  async hasLiveHold(input: { organizationId: string; userId: string }): Promise<boolean> {
    return (await this.findLiveHolds(input)).length > 0;
  }

  /** Whether the membership's role and custom roles make it a full seat, enabled or not. */
  async classifiesFull(input: {
    organizationId: string;
    userId: string;
    standing: Pick<MemberSeatStanding, "role">;
  }): Promise<boolean> {
    return (await this.memberTypeOf(input)) === "FullMember";
  }

  /** The seat pool the membership's role and custom roles put it in, enabled or not. */
  async memberTypeOf(input: {
    organizationId: string;
    userId: string;
    standing: Pick<MemberSeatStanding, "role">;
  }): Promise<MemberType> {
    const { memberships } = this.dependencies;
    if (input.standing.role !== "EXTERNAL")
      return classifyMemberType(input.standing.role, undefined);
    const teamIds = await memberships.findSharedTeamIds({ organizationId: input.organizationId });
    const customRoleIds = customRoleIdsOf({
      bindings: await memberships.findTeamGrants({ ...input, teamIds }),
    });
    const permissions =
      customRoleIds.length === 0
        ? []
        : customRolePermissionsOf({
            permissionsPerRole: await memberships.findCustomRolePermissions({
              organizationId: input.organizationId,
              customRoleIds,
            }),
          });
    return classifyMemberType(
      input.standing.role,
      permissions.length > 0 ? permissions : undefined,
    );
  }

  /**
   * The people waiting for a full seat, longest first. Today the people admission left disabled
   * for want of a seat; the one place a seat-request source replaces it.
   */
  findWaitingMembers(input: { organizationId: string }): Promise<WaitingMember[]> {
    return this.dependencies.memberships.findWaitingMembers(input);
  }

  /** Whether this person is waiting for a seat. */
  async isWaiting(input: { organizationId: string; userId: string }): Promise<boolean> {
    const waiting = await this.dependencies.memberships.findWaitingMembers(input);
    return waiting.some((member) => member.userId === input.userId);
  }

  async removalPreview(input: {
    organizationId: string;
    userId: string;
  }): Promise<SeatRemovalPreview> {
    const release = await this.releaseOf({ ...input, reason: "REMOVED" });
    if (release.kind !== "released") {
      return { holdsFullSeat: false, seatFreesAt: null, waiting: null };
    }
    if (release.hold) {
      return { holdsFullSeat: true, seatFreesAt: release.hold.heldUntil, waiting: null };
    }
    const [waiting] = await this.findWaitingMembers(input);
    return {
      holdsFullSeat: true,
      seatFreesAt: null,
      waiting: waiting && waiting.userId !== input.userId ? waiting : null,
    };
  }

  /**
   * Keeps the seat of a member who leaves by a path that deletes the membership row itself
   * (directory offboarding), written before that path runs. Nothing when no seat is kept.
   */
  async holdSeatOfDepartingMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const release = await this.releaseOf({ ...input, reason: "REMOVED" });
    if (release.kind !== "released" || !release.hold) return;
    await this.dependencies.memberships.writeSeatHold({ hold: release.hold });
  }

  /**
   * A person back within their hold (by user id, or by address for a new account), now an
   * enabled full member, takes the held seat: it keeps its date and the hold goes. Answers
   * whether a held seat was taken back.
   */
  async takeBackHeldSeat(input: {
    organizationId: string;
    userId: string;
    email?: string;
  }): Promise<boolean> {
    const { organizationId, userId } = input;
    const [standing] = await this.dependencies.memberships.findSeatStandings({
      organizationId,
      userId,
    });
    if (!standing || standing.disabledAt !== null) return false;
    const email = input.email ?? standing.email ?? undefined;
    const [hold] = await this.findLiveHolds({ organizationId, userId, email });
    if (!hold) return false;
    if (!(await this.classifiesFull({ organizationId, userId, standing }))) return false;
    await this.dependencies.memberships.takeHeldSeat({
      organizationId,
      userId,
      since: hold.seatTakenAt,
      holdUserIds: [hold.userId],
    });
    return true;
  }

  /** The addresses among these whose person still has a live hold: a seat they already have. */
  async findHeldEmails(input: {
    organizationId: string;
    emails: readonly string[];
  }): Promise<string[]> {
    const held = new Set(
      (await this.findHeld(input)).flatMap((hold) =>
        hold.email ? [hold.email.toLowerCase()] : [],
      ),
    );
    return input.emails.filter((email) => held.has(email.toLowerCase()));
  }

  /** The seats still held in the organization, for the Users list. */
  findHeld(input: { organizationId: string }): Promise<SeatHold[]> {
    return this.dependencies.holds.findLiveInOrganization({ ...input, now: this.now() });
  }

  /** The organizations with a hold ended at `now`, each one a seat may have freed in. */
  findOrganizationsWithEnded(input: { now: Instant }): Promise<string[]> {
    return this.dependencies.holds.findOrganizationsWithEnded(input);
  }

  /** Deletes the organization's holds ended at `now`. */
  deleteEnded(input: { organizationId: string; now: Instant }): Promise<void> {
    return this.dependencies.holds.deleteEnded(input);
  }

  private holdOf({
    organizationId,
    userId,
    reason,
    standing,
  }: {
    organizationId: string;
    userId: string;
    reason: SeatHoldReason;
    standing: MemberSeatStanding;
  }): SeatHold | null {
    const seatTakenAt = standing.fullSeatSince ?? standing.createdAt;
    const outcome = seatHoldOutcome({ seatTakenAt, now: this.now() });
    if (outcome.kind === "freed") return null;
    return {
      organizationId,
      userId,
      email: standing.email,
      name: standing.name,
      seatTakenAt,
      heldUntil: outcome.until,
      reason,
    };
  }
}
