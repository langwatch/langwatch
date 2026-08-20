import { Badge } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import {
  LuGitMerge,
  LuGitPullRequest,
  LuGitPullRequestClosed,
  LuGitPullRequestDraft,
} from "react-icons/lu";

import { Tooltip } from "~/components/ui/tooltip";

import {
  PULL_REQUEST_STATUS_LABELS,
  type PullRequestStatus,
} from "./pullRequestStatus";

/**
 * A pull request's state, drawn the way GitHub draws it: a solid badge in the
 * state's own color, carrying the same mark GitHub uses for it.
 *
 * A snapshot answer is the exception. It is drawn back so it never passes for
 * a live one, and says in its tooltip how old it is.
 */

/** GitHub's own colors for the four states. */
const STATUS_PALETTES: Record<PullRequestStatus, string> = {
  merged: "purple",
  open: "green",
  closed: "red",
  draft: "gray",
};

/** The mark GitHub puts next to each state. The label carries the meaning. */
const STATUS_ICONS: Record<PullRequestStatus, IconType> = {
  merged: LuGitMerge,
  open: LuGitPullRequest,
  closed: LuGitPullRequestClosed,
  draft: LuGitPullRequestDraft,
};

export function PullRequestStatusBadge({
  status,
  source,
  mappedAt = null,
}: {
  status: PullRequestStatus;
  source: "live" | "snapshot" | "payload";
  mappedAt?: Date | null;
}) {
  const label = PULL_REQUEST_STATUS_LABELS[status];

  if (source === "snapshot") {
    const asOf = mappedAt ? new Date(mappedAt).toLocaleDateString() : null;
    return (
      <Tooltip
        content={
          asOf
            ? `Last known status, from ${asOf}. GitHub is not answering right now.`
            : "Last known status. GitHub is not answering right now."
        }
      >
        <Badge
          size="sm"
          variant="outline"
          colorPalette="gray"
          color="fg.subtle"
          data-status-source="snapshot"
          data-status={status}
          // How stale the answer is only exists in the hover, so it gets a tab
          // stop too.
          tabIndex={0}
        >
          {label}
        </Badge>
      </Tooltip>
    );
  }

  const Icon = STATUS_ICONS[status];
  return (
    <Badge
      size="sm"
      variant="solid"
      colorPalette={STATUS_PALETTES[status]}
      data-status-source={source}
      data-status={status}
    >
      <Icon size={12} aria-hidden />
      {label}
    </Badge>
  );
}
