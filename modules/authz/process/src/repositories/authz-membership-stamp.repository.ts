/**
 * The membership generation a USER grant is fenced against: the writer reads
 * it under the row lock, the command carries it, and the projection re-checks
 * it before inserting, so an attach racing an offboarding cannot land.
 */
export type MembershipStampRow = {
  userId: string;
  membershipStamp: string;
};

export abstract class AuthzMembershipStampRepository {
  /**
   * The live membership rows among the ids asked for, each locked for the
   * duration of the read. A user with no live membership is simply absent —
   * refusing is the caller's decision, not the row's.
   */
  abstract findLockedStamps(input: {
    organizationId: string;
    userIds: string[];
  }): Promise<MembershipStampRow[]>;
}
