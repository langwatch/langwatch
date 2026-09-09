/**
 * The two kinds of seat a license meters, in the words the product uses.
 *
 * Which one a member holds is decided from their organization role and any
 * custom-role permissions, which is server work. The vocabulary itself is
 * shared: seat pricing, the seat-usage display and limit enforcement all name
 * the same two values, and they have to be the same two values.
 */
export type MemberType = "FullMember" | "LiteMember";
