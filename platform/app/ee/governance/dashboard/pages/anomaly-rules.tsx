// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Heading, VStack } from "@chakra-ui/react";
import { AnomalyRulesTab } from "@ee/governance/dashboard/components/AnomalyRulesTab";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The retired standalone address for anomaly rules. The rules now live in
 * the inventory's Anomaly rules tab (/governance/inventory?tab=anomaly-rules);
 * this page only hosts that same tab component under the section chrome
 * until the route redirect lands, after which this file goes. It carries no
 * logic of its own, so the two addresses can never drift.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
function AnomalyRulesPage() {
  return (
    <GovernanceLayout pageTitle="Anomaly rules · Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <Heading size="md">Anomaly rules</Heading>
        <AnomalyRulesTab />
      </VStack>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(AnomalyRulesPage),
);
