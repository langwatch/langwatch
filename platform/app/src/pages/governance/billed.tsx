import { Box, Text } from "@chakra-ui/react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * Billed - the organization's invoices and billing history. Placeholder
 * until the billing view ships; reachable only while
 * `release_ui_governance_billed_cost_enabled` is on.
 *
 * Spec: specs/governance/governance-navigation.feature
 */
function BilledPage() {
  return (
    <GovernanceLayout pageTitle="Billed">
      <Box paddingTop={16} textAlign="center">
        <Text color="fg.muted">
          Billing records for this organization are not available yet.
        </Text>
      </Box>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard(
  "release_ui_governance_billed_cost_enabled",
  {
    bypassOnboardingRedirect: true,
  },
)(
  withFeatureFlagGuard("release_ui_ai_governance_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governance:view", {
      bypassOnboardingRedirect: true,
    })(BilledPage),
  ),
);
