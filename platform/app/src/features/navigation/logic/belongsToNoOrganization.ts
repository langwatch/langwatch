/**
 * Whether the reader belongs to no organization at all — the one reading that
 * sends somebody to onboarding, so it has to be something the organization
 * graph SAID rather than something inferred from its silence.
 *
 * An unanswered graph and an empty one are the same `undefined`/`[]` pair to
 * most callers, and reading the first as the second is what put a member with
 * organizations on /onboarding/welcome for a beat before the landing redirect
 * corrected itself. `undefined` here means "not known yet", never "none".
 *
 * Spec: specs/navigation/workspace-resolution.feature
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
  /** Every organization the reader belongs to; `undefined` until the graph answers. */
  organizations: readonly unknown[] | undefined;
}): boolean {
  if (isWorkspaceResolving) return false;
  if (organization) return false;
  // Length zero on a list that EXISTS. An absent list is an unanswered read.
  return organizations?.length === 0;
}
