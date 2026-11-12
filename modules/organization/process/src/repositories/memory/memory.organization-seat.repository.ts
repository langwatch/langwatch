import {
  classifyMemberType,
  isDeveloper,
  isFullMember,
  isLiteMember,
  type MemberType,
} from "@langwatch/entitlement-contract";
import {
  type OrganizationMemberSeats,
  OrganizationUserRole,
} from "@langwatch/organization-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import { z } from "zod";

import { seatKindOf } from "../../rules/seat-change.rules.ts";
import {
  type CountedSeatHold,
  type OrganizationSeatHolding,
  OrganizationSeatRepository,
  type SeatLease,
} from "../organization-seat.repository.ts";
import type {
  MemoryOrganizationDatabase,
  MemoryOrganizationInviteRow,
  MemoryOrganizationUserRow,
} from "./memory.organization.database.ts";

/** An invitation's team assignments as stored; anything else reads as none. */
const teamAssignmentsSchema = z.array(
  z.looseObject({ teamId: z.string(), customRoleId: z.string().optional() }),
);
const permissionsSchema = z.array(z.string());

type SeatPredicate = (role: OrganizationUserRole, permissions: string[] | undefined) => boolean;

/** A role's permissions where the organization defines it; undefined where it does not. */
type PermissionsOf = (customRoleId: string | null | undefined) => string[] | undefined;

function defined(permissions: (string[] | undefined)[]): string[][] {
  return permissions.filter((entry): entry is string[] => entry !== undefined);
}

function isLive(invite: MemoryOrganizationInviteRow, now: Instant): boolean {
  return (
    invite.status === "PENDING" &&
    (invite.expiration === null || invite.expiration.epochMilliseconds > now.epochMilliseconds)
  );
}

/** A live invitation's permissions: its assignments' roles merged; empty when it names none. */
function mergedInvitePermissions(
  invite: MemoryOrganizationInviteRow,
  permissionsOf: PermissionsOf,
): string[] {
  const assignments = teamAssignmentsSchema.safeParse(invite.teamAssignments).data;
  return defined((assignments ?? []).map((entry) => permissionsOf(entry.customRoleId))).flat();
}

/** The seat a live invitation takes: its merged permissions, none if it names no role. */
function inviteMemberType(
  invite: MemoryOrganizationInviteRow,
  permissionsOf: PermissionsOf,
): MemberType {
  const merged = mergedInvitePermissions(invite, permissionsOf);
  return classifyMemberType(invite.role, merged.length > 0 ? merged : undefined);
}

/** Whether a live invitation holds this seat. */
function inviteHoldsSeat(
  invite: MemoryOrganizationInviteRow,
  permissionsOf: PermissionsOf,
  predicate: SeatPredicate,
): boolean {
  const merged = mergedInvitePermissions(invite, permissionsOf);
  return predicate(invite.role, merged.length > 0 ? merged : undefined);
}

/**
 * Seat counts over the memory tables, classified as the Postgres repository classifies them.
 * With no grant ledger here, a team membership's custom role stands in for the TEAM binding.
 */
export class MemoryOrganizationSeatRepository extends OrganizationSeatRepository {
  static create(options: { memory: MemoryOrganizationDatabase }): MemoryOrganizationSeatRepository {
    return new MemoryOrganizationSeatRepository(options.memory);
  }

  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  /** The tail of each organization's queue; a hold starts once the one before it settled. */
  readonly #seatQueues = new Map<string, Promise<unknown>>();

  async withSeatLock<T>({
    organizationId,
    work,
  }: {
    organizationId: string;
    work: (lease: SeatLease) => Promise<T>;
  }): Promise<T> {
    const previous = this.#seatQueues.get(organizationId) ?? Promise.resolve();
    // The queue never hands a hold to another change, so the lease is always still held.
    const held = previous.then(() => work({ assertHeld: async () => {} }));
    const settled = held.catch(() => undefined);
    this.#seatQueues.set(organizationId, settled);
    try {
      return await held;
    } finally {
      if (this.#seatQueues.get(organizationId) === settled) this.#seatQueues.delete(organizationId);
    }
  }

  /** Each held lease's way to let the next hold on its organization start. */
  readonly #leaseHolders = new Map<string, () => void>();

  /** Joins the same queue `withSeatLock` holds, until the holder releases. */
  async acquireSeatLease({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ holder: string; renewEveryMs: number }> {
    const previous = this.#seatQueues.get(organizationId) ?? Promise.resolve();
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#seatQueues.set(
      organizationId,
      previous.then(() => released),
    );
    await previous;
    const holder = `memory-lease-${this.#leaseHolders.size + 1}-${organizationId}`;
    this.#leaseHolders.set(holder, release);
    return { holder, renewEveryMs: 5_000 };
  }

  async renewSeatLease({ holder }: { organizationId: string; holder: string }): Promise<boolean> {
    return this.#leaseHolders.has(holder);
  }

  async releaseSeatLease({ holder }: { organizationId: string; holder: string }): Promise<void> {
    this.#leaseHolders.get(holder)?.();
    this.#leaseHolders.delete(holder);
  }

  async getMemberCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).fullMembers;
  }

  async getMembersLiteCount(organizationId: string): Promise<number> {
    return this.#count(organizationId, isLiteMember);
  }

  async getMembersDeveloperCount(organizationId: string): Promise<number> {
    return this.#count(organizationId, isDeveloper);
  }

  async countMemberSeats(organizationId: string): Promise<OrganizationMemberSeats> {
    return {
      fullMembers:
        this.#count(organizationId, isFullMember) + this.#countedHolds({ organizationId }).length,
      liteMembers: this.#count(organizationId, isLiteMember),
      developers: this.#count(organizationId, isDeveloper),
    };
  }

  /** A full seat stays counted until its hold ends, unless its person holds a full seat again. */
  #countedHolds({
    organizationId,
    ignoringInviteId,
  }: {
    organizationId: string;
    ignoringInviteId?: string;
  }): MemoryOrganizationDatabase["seatHolds"] {
    const fullUserIds = new Set(
      this.#members(organizationId, isFullMember).map((member) => member.userId),
    );
    const now = nowInstant();
    const permissionsOf = this.#permissionsOf(organizationId);
    const invitedEmails = new Set(
      [...this.memory.invites.values()]
        .filter(
          (invite) =>
            invite.organizationId === organizationId &&
            invite.id !== ignoringInviteId &&
            isLive(invite, now) &&
            inviteHoldsSeat(invite, permissionsOf, isFullMember),
        )
        .map((invite) => invite.email.toLowerCase()),
    );
    return this.memory.seatHolds.filter(
      (hold) =>
        hold.organizationId === organizationId &&
        Temporal.Instant.compare(hold.heldUntil, now) > 0 &&
        !fullUserIds.has(hold.userId) &&
        !(hold.email && invitedEmails.has(hold.email.toLowerCase())),
    );
  }

  async findCountedHold({
    organizationId,
    userId,
    ignoringInviteId,
  }: {
    organizationId: string;
    userId: string;
    ignoringInviteId?: string;
  }): Promise<CountedSeatHold[]> {
    return this.#countedHolds({ organizationId, ignoringInviteId })
      .filter((hold) => hold.userId === userId)
      .map((hold) => ({ userId, heldUntil: hold.heldUntil.epochMilliseconds }));
  }

  async findHoldUserIdsByEmail({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string;
  }): Promise<string[]> {
    const now = nowInstant();
    return this.memory.seatHolds
      .filter(
        (hold) =>
          hold.organizationId === organizationId &&
          hold.email?.toLowerCase() === email.toLowerCase() &&
          Temporal.Instant.compare(hold.heldUntil, now) > 0,
      )
      .map((hold) => hold.userId);
  }

  async findFullSeatHolderIds(organizationId: string): Promise<string[]> {
    return this.#members(organizationId, isFullMember).map((member) => member.userId);
  }

  async findSeatHolders(organizationId: string): Promise<OrganizationSeatHolding[]> {
    const permissionsOf = this.#permissionsOf(organizationId);
    const now = nowInstant();
    return [
      ...this.#countedHolds({ organizationId }).map((hold) => ({
        holder: {
          kind: "hold" as const,
          userId: hold.userId,
          expiresAt: hold.heldUntil.epochMilliseconds,
        },
        seat: "full" as const,
      })),
      ...this.memory.organizationUsers
        .filter(
          (member) =>
            member.organizationId === organizationId &&
            member.disabledAt === null &&
            (this.memory.users.get(member.userId)?.deactivatedAt ?? null) === null,
        )
        .map((member) => ({
          holder: { kind: "member" as const, userId: member.userId },
          seat: seatKindOf(
            classifyMemberType(member.role, this.#memberPermissions(member, permissionsOf)),
          ),
        })),
      ...[...this.memory.invites.values()]
        .filter((invite) => invite.organizationId === organizationId && isLive(invite, now))
        .map((invite) => ({
          holder: {
            kind: "invitation" as const,
            inviteId: invite.id,
            expiresAt: invite.expiration?.epochMilliseconds ?? null,
          },
          seat: seatKindOf(inviteMemberType(invite, permissionsOf)),
        })),
    ];
  }

  async findMemberSeat({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<MemberType | null> {
    const member = this.memory.organizationUsers.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.userId === userId &&
        candidate.disabledAt === null &&
        (this.memory.users.get(userId)?.deactivatedAt ?? null) === null,
    );
    if (!member) return null;
    const permissionsOf = this.#permissionsOf(organizationId);
    return classifyMemberType(member.role, this.#memberPermissions(member, permissionsOf));
  }

  async findInvitationSeat({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<MemberType | null> {
    const invite = this.memory.invites.get(inviteId);
    if (!invite || invite.organizationId !== organizationId || !isLive(invite, nowInstant())) {
      return null;
    }
    return inviteMemberType(invite, this.#permissionsOf(organizationId));
  }

  #permissionsOf(organizationId: string): PermissionsOf {
    return (customRoleId) => {
      const role = customRoleId ? this.memory.customRoles.get(customRoleId) : undefined;
      if (role?.organizationId !== organizationId) return undefined;
      return permissionsSchema.safeParse(role.permissions).data ?? [];
    };
  }

  /** Disabled memberships and deactivated people hold no seat (seat-reconciliation.feature). */
  #members(organizationId: string, predicate: SeatPredicate): MemoryOrganizationUserRow[] {
    const permissionsOf = this.#permissionsOf(organizationId);
    return this.memory.organizationUsers.filter(
      (member) =>
        member.organizationId === organizationId &&
        member.disabledAt === null &&
        (this.memory.users.get(member.userId)?.deactivatedAt ?? null) === null &&
        predicate(member.role, this.#memberPermissions(member, permissionsOf)),
    );
  }

  #count(organizationId: string, predicate: SeatPredicate): number {
    const permissionsOf = this.#permissionsOf(organizationId);
    const memberSeats = this.#members(organizationId, predicate).length;
    const now = nowInstant();
    const inviteSeats = [...this.memory.invites.values()].filter(
      (invite) =>
        invite.organizationId === organizationId &&
        isLive(invite, now) &&
        inviteHoldsSeat(invite, permissionsOf, predicate),
    ).length;
    return memberSeats + inviteSeats;
  }

  /** An EXTERNAL member's permissions through the organization's teams; nobody else's count. */
  #memberPermissions(
    member: MemoryOrganizationUserRow,
    permissionsOf: PermissionsOf,
  ): string[] | undefined {
    if (member.role !== OrganizationUserRole.EXTERNAL) return undefined;
    const bound = defined(
      this.memory.teamUsers
        .filter(
          (row) =>
            row.userId === member.userId &&
            this.memory.teams.get(row.teamId)?.organizationId === member.organizationId,
        )
        .map((row) => permissionsOf(row.customRoleId)),
    );
    return bound.length > 0 ? bound.flat() : undefined;
  }
}
