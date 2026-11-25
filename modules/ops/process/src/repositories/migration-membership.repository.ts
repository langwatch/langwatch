/** The user-rooted cohort's probe: does this person belong to any of these organizations. */
export interface MigrationMembershipRepository {
  isMemberOfAny(args: { userId: string; organizationIds: readonly string[] }): Promise<boolean>;
}
