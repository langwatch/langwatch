/**
 * Where a pull request stands, and how the stored snapshot reads it: the
 * snapshot-side derivation, matching the live status service's read of
 * GitHub's fields — one story, not each caller re-deciding what "merged" means.
 */

export type PullRequestStatus = "open" | "draft" | "merged" | "closed";

export const PULL_REQUEST_STATUS_LABELS: Record<PullRequestStatus, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/**
 * The order a status column sorts in: the work still in flight first, the work
 * already landed after it, and the abandoned work last.
 */
export const PULL_REQUEST_STATUS_SORT_RANK = {
  open: 0,
  draft: 1,
  merged: 2,
  closed: 3,
} as const;

/**
 * A merged pull request is closed on GitHub too, so the merge has to be read
 * before the close or every merge would report as closed. A draft only counts
 * while the pull request is still open.
 */
export function derivePullRequestStatus({
  state,
  isDraft,
  prMergedAtMs,
}: {
  state: string;
  isDraft: boolean;
  prMergedAtMs: number | null;
}): PullRequestStatus {
  if (prMergedAtMs !== null) return "merged";
  if (state === "closed") return "closed";
  if (isDraft) return "draft";
  return "open";
}
