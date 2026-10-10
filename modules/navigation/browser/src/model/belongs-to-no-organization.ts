/**
 * Whether the reader belongs to no organization at all. Onboarding hangs off
 * this, so it must be something the graph SAID: an absent list is a read that
 * has not answered, never a reader who belongs to nothing.
 */
export function belongsToNoOrganization({
  isWorkspaceResolving,
  organization,
  organizations,
}: {
  /** Whether the workspace read is still in progress. */
  isWorkspaceResolving: boolean;
  /** The organization the current address resolved to, if any. */
  organization: unknown;
  /** Every organization the reader belongs to; absent until the graph answers. */
  organizations: readonly unknown[] | undefined;
}): boolean {
  if (isWorkspaceResolving) return false;
  if (organization) return false;
  // Length zero on a list that EXISTS. An absent list is an unanswered read.
  return organizations?.length === 0;
}
