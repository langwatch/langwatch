import { isDeveloper, isFullMember, isLiteMember } from "@langwatch/entitlement-contract";
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { z } from "zod";

import { OrganizationSeatRepository } from "../organization-seat.repository.ts";
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

/** Whether a live invitation holds this seat: its assignments' roles merged, none if empty. */
function inviteHoldsSeat(
  invite: MemoryOrganizationInviteRow,
  permissionsOf: PermissionsOf,
  predicate: SeatPredicate,
): boolean {
  const assignments = teamAssignmentsSchema.safeParse(invite.teamAssignments).data;
  const merged = defined(
    (assignments ?? []).map((entry) => permissionsOf(entry.customRoleId)),
  ).flat();
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

  async getMemberCount(organizationId: string): Promise<number> {
    return this.#count(organizationId, isFullMember);
  }

  async getMembersLiteCount(organizationId: string): Promise<number> {
    return this.#count(organizationId, isLiteMember);
  }

  async getMembersDeveloperCount(organizationId: string): Promise<number> {
    return this.#count(organizationId, isDeveloper);
  }

  #count(organizationId: string, predicate: SeatPredicate): number {
    const permissionsOf: PermissionsOf = (customRoleId) => {
      const role = customRoleId ? this.memory.customRoles.get(customRoleId) : undefined;
      if (role?.organizationId !== organizationId) return undefined;
      return permissionsSchema.safeParse(role.permissions).data ?? [];
    };
    // Disabled memberships hold no access and hold no seat (seat-reconciliation.feature).
    const memberSeats = this.memory.organizationUsers.filter(
      (member) =>
        member.organizationId === organizationId &&
        member.disabledAt === null &&
        predicate(member.role, this.#memberPermissions(member, permissionsOf)),
    ).length;
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
