/**
 * What the Braids pages say while `release_braids` is off: the braids already made still apply,
 * and this is where to end them. Spec: modules/authz/specs/braids-release-flag.feature.
 */

import { Banner } from "@langwatch/design-system/banner";

export function BraidsNotEnabledBanner({ removeHere }: { removeHere: boolean }) {
  return (
    <Banner status="info" title="Braids is not enabled" data-testid="braids-not-enabled">
      {removeHere
        ? "Braids that already exist still apply to traces. You can remove them here."
        : "Braids that already exist still apply to traces. You can remove them from each project's Braids page."}
    </Banner>
  );
}
