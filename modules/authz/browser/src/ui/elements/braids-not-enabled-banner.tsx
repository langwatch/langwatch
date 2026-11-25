/**
 * What the Braids pages say while `release_braids` is off: the braids already made still apply,
 * unless the plan or the organisation's own setting paused them, and this is where to end them.
 * An unread setting says neither. Spec: modules/authz/specs/braids-release-flag.feature.
 */

import { Banner } from "@langwatch/design-system/banner";

import type { BraidsStatus } from "../../model/braids/braids.ts";

const STATE: Record<BraidsStatus, string> = {
  applying: "Braids that already exist still apply to traces.",
  organization:
    "Your organisation turned Braids off, so braids that already exist are paused and kept.",
  plan: "Braids that already exist are paused and kept, since they need the Enterprise plan.",
  unknown:
    "Couldn't read whether your organisation has Braids on, so braids that already exist may be paused.",
};

export function BraidsNotEnabledBanner({
  removeHere,
  status,
}: {
  removeHere: boolean;
  /** Whether the braids already made apply, what paused them, or unknown while unread. */
  status: BraidsStatus;
}) {
  return (
    <Banner status="info" title="Braids is not enabled" data-testid="braids-not-enabled">
      {STATE[status]}{" "}
      {removeHere
        ? "You can remove them here."
        : "You can remove them from each project's Braids page."}
    </Banner>
  );
}
