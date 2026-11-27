import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type {
  STAFF_ACCESS_PEOPLE_FUNCTIONS,
  StaffAccessFunctionInput,
  StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import { Temporal } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import { pageOf } from "../rules/staff-access-function.rules.ts";
import { isoText } from "../rules/staff-access.rules.ts";
import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type PeopleReadsDeps = Readonly<{
  organizations: Pick<
    OrganizationApi,
    | "findInviteFacts"
    | "listMembers"
    | "getInvitedMemberIds"
    | "organizationIdsForMember"
    | "listAllIds"
    | "countMemberSeats"
  >;
  users: Pick<UserApi, "findSignInAccounts" | "getProfiles">;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
}>;

type MemberRole = StaffAccessFunctionOutput<"org.members">["items"][number]["role"];
type InviteState = StaffAccessFunctionOutput<"org.invites">["items"][number]["state"];

const ROLES: readonly MemberRole[] = ["admin", "member", "external", "developer"];
const INVITE_STATES: readonly InviteState[] = [
  "pending",
  "accepted",
  "expired",
  "revoked",
  "waiting_approval",
  "payment_pending",
];
/** Members read per page from organization, and profiles asked per call from user. */
const MEMBER_BATCH = 500;
/** Organizations counted at once by the seat scan, so it never floods the database. */
const SEAT_SCAN_CONCURRENCY = 8;

/** The people ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessPeopleFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_PEOPLE_FUNCTIONS>;

  private constructor(private readonly deps: PeopleReadsDeps) {
    this.reads = {
      "org.invites": (call) => this.invites(call),
      "users.find": (call) => this.findUsers(call),
      "org.members": (call) => this.members(call),
      "orgs.seat_overage": (call) => this.seatOverage(call),
    };
  }

  static create(deps: PeopleReadsDeps): StaffAccessPeopleFunctionReadsService {
    return new StaffAccessPeopleFunctionReadsService(deps);
  }

  private async invites({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"org.invites">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.invites">> {
    const facts = await this.deps.organizations.findInviteFacts({ organizationId });
    const rows = facts
      .map((fact) => ({
        inviteId: fact.inviteId,
        role: codeOf({ value: fact.role, known: ROLES }),
        state: codeOf({ value: fact.status, known: INVITE_STATES }),
        billingOnly: fact.billingOnly,
        viaCheckout: fact.viaCheckout,
        teamIds: [...fact.teamIds],
        requestedByUserId: fact.requestedByUserId,
        acceptedByUserId: fact.acceptedByUserId,
        createdAt: isoOfMs(fact.createdAt),
        updatedAt: isoOfMs(fact.updatedAt),
        expiresAt: fact.expiresAt === null ? null : isoOfMs(fact.expiresAt),
      }))
      .filter((row) => input.state === undefined || row.state === input.state);
    return pageOf({
      rows,
      keyOf: (row) => row.inviteId,
      name: "org.invites",
      ...pageInputOf(input),
    });
  }

  private async findUsers({
    input,
  }: {
    input: StaffAccessFunctionInput<"users.find">;
  }): Promise<StaffAccessFunctionOutput<"users.find">> {
    const accounts = await this.deps.users.findSignInAccounts({ email: input.email });
    const rows = await Promise.all(
      accounts.map(async (account) => {
        const [all, active] = await Promise.all([
          this.deps.organizations.organizationIdsForMember({ userId: account.userId }),
          this.deps.organizations.organizationIdsForMember({
            userId: account.userId,
            activeOnly: true,
          }),
        ]);
        const activeIds = new Set(active);
        return {
          userId: account.userId,
          createdAt: isoOfMs(account.createdAt),
          deactivated: account.deactivated,
          orgIds: [...activeIds].toSorted(),
          disabledOrgIds: all.filter((id) => !activeIds.has(id)).toSorted(),
        };
      }),
    );
    return pageOf({ rows, keyOf: (row) => row.userId, name: "users.find" });
  }

  private async members({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"org.members">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.members">> {
    const [members, provenance] = await Promise.all([
      this.allMembersOf({ organizationId }),
      this.deps.organizations.getInvitedMemberIds({ organizationId }),
    ]);
    const invited = new Set(provenance.invitedUserIds);
    const profiles = new Map<string, { lastSignInAt: number | null; deactivated: boolean }>();
    for (let at = 0; at < members.length; at += MEMBER_BATCH) {
      const userIds = members.slice(at, at + MEMBER_BATCH).map((member) => member.userId);
      for (const profile of await this.deps.users.getProfiles({ userIds })) {
        profiles.set(profile.id, {
          lastSignInAt: profile.lastLoginAt?.getTime() ?? null,
          deactivated: profile.deactivatedAt !== null,
        });
      }
    }
    const rows = members.map((member) => {
      const profile = profiles.get(member.userId);
      return {
        userId: member.userId,
        role: codeOf({ value: member.role, known: ROLES }),
        invited: invited.has(member.userId),
        joinedAt: isoText(member.createdAt),
        disabledAt: member.disabledAt === null ? null : isoText(member.disabledAt),
        lastSignInAt: profile?.lastSignInAt ? isoOfMs(profile.lastSignInAt) : null,
        deactivated: profile?.deactivated ?? false,
      };
    });
    return pageOf({
      rows,
      keyOf: (row) => row.userId,
      name: "org.members",
      ...pageInputOf(input),
    });
  }

  /** Every member of the organization, disabled ones included, read in batches. */
  private async allMembersOf({ organizationId }: { organizationId: string }) {
    const first = await this.deps.organizations.listMembers({
      organizationId,
      includeDisabled: true,
      offset: 0,
      limit: MEMBER_BATCH,
    });
    const members = [...first.members];
    while (members.length < first.totalCount) {
      const next = await this.deps.organizations.listMembers({
        organizationId,
        includeDisabled: true,
        offset: members.length,
        limit: MEMBER_BATCH,
      });
      if (next.members.length === 0) break;
      members.push(...next.members);
    }
    const byUser = new Map(members.map((member) => [member.userId, member]));
    return [...byUser.values()];
  }

  /**
   * Counts every organization's seats and resolves the plan of each that holds any, a few at a
   * time. An uncapped plan reports `Number.MAX_SAFE_INTEGER`, read here as no cap.
   */
  private async seatOverage({
    input,
  }: {
    input: StaffAccessFunctionInput<"orgs.seat_overage">;
  }): Promise<StaffAccessFunctionOutput<"orgs.seat_overage">> {
    const { ids } = await this.deps.organizations.listAllIds();
    const rows = (
      await mapInBatches({
        items: ids,
        size: SEAT_SCAN_CONCURRENCY,
        map: (organizationId) => this.overageOf({ organizationId }),
      })
    ).flatMap((row) => (row === null ? [] : [row]));
    return pageOf({
      rows,
      keyOf: (row) => row.organizationId,
      name: "orgs.seat_overage",
      ...pageInputOf(input),
    });
  }

  private async overageOf({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"orgs.seat_overage">["items"][number] | null> {
    const seats = await this.deps.organizations.countMemberSeats({ organizationId });
    if (seats.fullMembers === 0 && seats.liteMembers === 0) return null;
    const plan = await this.deps.entitlements.getActivePlan({ organizationId });
    const fullSeatCap = plan.maxMembers >= Number.MAX_SAFE_INTEGER ? null : plan.maxMembers;
    const liteSeatCap = plan.maxMembersLite >= Number.MAX_SAFE_INTEGER ? null : plan.maxMembersLite;
    const overBy =
      overOf({ used: seats.fullMembers, cap: fullSeatCap }) +
      overOf({ used: seats.liteMembers, cap: liteSeatCap });
    if (overBy === 0) return null;
    return {
      organizationId,
      plan: plan.type,
      fullSeatCap,
      fullSeatsUsed: seats.fullMembers,
      liteSeatCap,
      liteSeatsUsed: seats.liteMembers,
      overBy,
      overPlanSince: plan.overPlan ? isoOfMs(plan.overPlan.sinceMs) : null,
    };
  }
}

function overOf({ used, cap }: { used: number; cap: number | null }): number {
  return cap === null ? 0 : Math.max(0, used - cap);
}

/** A stored value as its lower-case code, or `other` for one this read does not know. */
function codeOf<Code extends string>({
  value,
  known,
}: {
  value: string;
  known: readonly Code[];
}): Code | "other" {
  const lowered = value.toLowerCase();
  return known.find((code) => code === lowered) ?? "other";
}

async function mapInBatches<Item, Result>({
  items,
  size,
  map,
}: {
  items: readonly Item[];
  size: number;
  map: (item: Item) => Promise<Result>;
}): Promise<Result[]> {
  const results: Result[] = [];
  for (let at = 0; at < items.length; at += size) {
    results.push(...(await Promise.all(items.slice(at, at + size).map(map))));
  }
  return results;
}

function isoOfMs(ms: number): string {
  return isoText(Temporal.Instant.fromEpochMilliseconds(ms));
}

function pageInputOf(input: { limit?: number; cursor?: string }): {
  limit?: number;
  cursor?: string;
} {
  return {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}
