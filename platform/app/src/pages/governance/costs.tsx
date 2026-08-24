import { Box, Text } from "@chakra-ui/react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * Costs - the per-tool and per-team spend view for the organization.
 * Placeholder until the cost rollup ships; reachable only while
 * `release_ui_governance_billed_cost_enabled` is on.
 *
 * Spec: specs/governance/governance-navigation.feature
 */
function CostsPage() {
  return (
    <GovernanceLayout pageTitle="Costs">
      <Box paddingTop={16} textAlign="center">
        <Text color="fg.muted">
          Cost data for this organization is not available yet.
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
    })(CostsPage),
  ),
);
