import { Heading, Text, VStack } from "@chakra-ui/react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * Placeholder for the Costs view: the page and its nav item ship behind
 * `release_ui_governance_billed_cost_enabled` ahead of the spend views,
 * so the rail shape lands before the data does. No queries, no state.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 * (the billed-cost flag section).
 */
function CostsPage() {
  return (
    <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <Heading size="md">Costs</Heading>
        <Text color="fg.muted">
          Cost views are on their way. Nothing to see here yet.
        </Text>
      </VStack>
    </GovernanceLayout>
  );
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
    })(CostsPage),
  ),
);
