import { NotFoundScene } from "~/components/NotFoundScene";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The unfinished Billed destination stays unavailable even when Costs is
 * enabled. Keep its existing guards and route, but expose no placeholder.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 * (the billed-cost flag section).
 */
function BilledPage() {
  return <NotFoundScene />;
}

// Composed on top of the section-wide governance flag, never instead of
// it: flipping the section flag off still hides this page.
export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withFeatureFlagGuard("release_ui_governance_billed_cost_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governance:view", {
      bypassOnboardingRedirect: true,
    })(BilledPage),
  ),
);
