import type { MemberType } from "@langwatch/entitlement-contract";
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { SeatHolder, SeatKind } from "../rules/seat-holder.rules.ts";

/** One holder and the seat it takes, classified as the counts above classify it. */
export type OrganizationSeatHolding = Readonly<{
  holder: SeatHolder;
  seat: SeatKind;
  /** A hold holding no seat because a live full invitation to its address took it: that one. */
  suppressedBy?: string;
}>;

/** A seat hold that counts as a full seat, and when it ends (epoch milliseconds). */
export type CountedSeatHold = Readonly<{ userId: string; heldUntil: number }>;

/**
 * The seat lease as the work under it holds it: `assertHeld` right before each seat-holding
 * write refuses seat_change_busy when the lease went to another change meanwhile.
 */
export interface SeatLease {
  assertHeld(): Promise<void>;
}

/**
 * An organization's seats as they are counted for a licence and a plan: the full
 * and the lite members holding one, live invitations included. Disabled
 * memberships hold no access and hold no seat (seat-reconciliation.feature).
 */
export abstract class OrganizationSeatRepository {
  /** Members holding a FULL seat right now, live invitations included. */
  abstract getMemberCount(organizationId: string): Promise<number>;
  /** Members holding a LITE seat right now, live invitations included. */
  abstract getMembersLiteCount(organizationId: string): Promise<number>;
  /** Members holding a Developer seat (ADR-171): counted, never capped. */
  abstract getMembersDeveloperCount(organizationId: string): Promise<number>;
  /** All three in one read, for a check that asks after both pools at once. */
  abstract countMemberSeats(organizationId: string): Promise<OrganizationMemberSeats>;
  /** The people holding a FULL seat right now; invitations hold no person yet. */
  abstract findFullSeatHolderIds(organizationId: string): Promise<string[]>;
  /**
   * Runs `work` while no other seat-taking write on the organization runs, so a count read
   * inside it still holds when the write lands. Never nested: a second hold on the same
   * organization from inside `work` waits on itself.
   */
  abstract withSeatLock<T>(input: {
    organizationId: string;
    work: (lease: SeatLease) => Promise<T>;
  }): Promise<T>;
  /** The same lease for a holder outside this process's `work`, and how often it renews it. */
  abstract acquireSeatLease(input: {
    organizationId: string;
  }): Promise<{ holder: string; renewEveryMs: number }>;
  /** False when the lease is no longer this holder's. */
  abstract renewSeatLease(input: { organizationId: string; holder: string }): Promise<boolean>;
  abstract releaseSeatLease(input: { organizationId: string; holder: string }): Promise<void>;
  /** Every seat holder and its seat, live invitations included: the seat peak's opening count. */
  abstract findSeatHolders(organizationId: string): Promise<OrganizationSeatHolding[]>;
  /** One member's seat by the rule the counts use; null when they hold none. */
  abstract findMemberSeat(input: {
    organizationId: string;
    userId: string;
  }): Promise<MemberType | null>;
  /**
   * The person's seat hold when it counts as a full seat by the rule the counts use, with its end;
   * `ignoringInviteId` reads it as if that invitation were not there. Empty when none counts.
   */
  abstract findCountedHold(input: {
    organizationId: string;
    userId: string;
    ignoringInviteId?: string;
  }): Promise<CountedSeatHold[]>;
  /** The people whose live seat hold names this address, counted or not. */
  abstract findHoldUserIdsByEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<string[]>;
  /** One live invitation's seat by the rule the counts use; null when it holds none. */
  abstract findInvitationSeat(input: {
    organizationId: string;
    inviteId: string;
  }): Promise<MemberType | null>;
}
