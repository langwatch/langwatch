import type { OrganizationMemberSeats } from "./organization.api.ts";

/**
 * Whether one more full and one more lite member fit the plan (PC-SCIM-SEAT): an override
 * lifts both caps, else each pool must sit below its allowance. Developers are never capped.
 */
export function seatsFree({
  plan,
  seats,
}: Readonly<{
  plan: Readonly<{
    overrideAddingLimitations?: boolean;
    maxMembers: number;
    maxMembersLite: number;
  }>;
  seats: OrganizationMemberSeats;
}>): Readonly<{ fullSeatFree: boolean; liteSeatFree: boolean }> {
  const lifted = plan.overrideAddingLimitations === true;
  return {
    fullSeatFree: lifted || seats.fullMembers < plan.maxMembers,
    liteSeatFree: lifted || seats.liteMembers < plan.maxMembersLite,
  };
}
