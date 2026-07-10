import { Text } from "@chakra-ui/react";

/**
 * Itemized seat usage for the members page (ADR-039 Decision 13). Pending
 * invites reserve seats by design (prevents overselling), so the line spells
 * out where the count comes from — "4 members + 2 pending invites" — instead
 * of a bare 6/6 that looks wrong to an admin who only sees 4 people. The
 * pending-invites table on the same page carries the revoke action.
 */
export function MemberSeatUsageLine({
  memberCount,
  pendingInviteCount,
  current,
  max,
}: {
  memberCount: number;
  pendingInviteCount: number;
  /** Seats consumed, as counted by enforcement (members + pending invites). */
  current: number;
  /** Seats available on the current plan. */
  max: number;
}) {
  const itemization =
    pendingInviteCount > 0
      ? `${memberCount} ${memberCount === 1 ? "member" : "members"} + ${pendingInviteCount} pending ${pendingInviteCount === 1 ? "invite" : "invites"}`
      : `${memberCount} ${memberCount === 1 ? "member" : "members"}`;

  return (
    <Text fontSize="sm" color="gray.500" data-testid="member-seat-usage">
      {current} of {max} seats used — {itemization}
    </Text>
  );
}
