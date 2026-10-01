/**
 * The two kinds of seat a license meters. Which one a member holds is
 * server-decided (role, custom-role permissions); seat pricing, usage
 * display and limit enforcement all must name the same two values.
 */
export type MemberType = "FullMember" | "LiteMember";
