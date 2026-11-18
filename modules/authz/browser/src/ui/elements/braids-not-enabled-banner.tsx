/**
 * What the Braids pages say while `release_braids` is off: the braids already made still apply,
 * unless the organisation turned Braids off and paused them, and this is where to end them.
 * Spec: modules/authz/specs/braids-release-flag.feature.
 */

import { Banner } from "@langwatch/design-system/banner";

export function BraidsNotEnabledBanner({
  removeHere,
  paused,
}: {
  removeHere: boolean;
  /** The organisation turned Braids off, so its braids are paused rather than applying. */
  paused: boolean;
}) {
  const state = paused
    ? "Your organisation turned Braids off, so braids that already exist are paused and kept."
    : "Braids that already exist still apply to traces.";
  return (
    <Banner status="info" title="Braids is not enabled" data-testid="braids-not-enabled">
      {state}{" "}
      {removeHere
        ? "You can remove them here."
        : "You can remove them from each project's Braids page."}
    </Banner>
  );
}
