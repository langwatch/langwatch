/**
 * What the Braids pages say while `release_braids` is off: the braids already made still apply,
 * unless the plan or the organisation's own setting paused them, and this is where to end them.
 * Spec: modules/authz/specs/braids-release-flag.feature.
 */

import { Banner } from "@langwatch/design-system/banner";

const STATE = {
  applying: "Braids that already exist still apply to traces.",
  organization:
    "Your organisation turned Braids off, so braids that already exist are paused and kept.",
  plan: "Braids that already exist are paused and kept, since they need the Enterprise plan.",
} as const;

export function BraidsNotEnabledBanner({
  removeHere,
  pausedBy,
}: {
  removeHere: boolean;
  /** What paused the braids so they don't apply: the organisation's setting or the plan. */
  pausedBy: "organization" | "plan" | undefined;
}) {
  return (
    <Banner status="info" title="Braids is not enabled" data-testid="braids-not-enabled">
      {STATE[pausedBy ?? "applying"]}{" "}
      {removeHere
        ? "You can remove them here."
        : "You can remove them from each project's Braids page."}
    </Banner>
  );
}
