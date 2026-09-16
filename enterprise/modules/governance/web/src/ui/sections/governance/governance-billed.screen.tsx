import { Heading, Text, VStack } from "@chakra-ui/react";

import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";

/**
 * Placeholder for the Billed view: ships behind
 * `release_ui_governance_billed_cost_enabled` ahead of the spend views.
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature (billed-cost section).
 */
function BilledPage() {
  return (
    <GovernanceLayout pageTitle="Billed · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <Heading size="md">Billed</Heading>
        <Text color="fg.muted">Billed views are on their way. Nothing to see here yet.</Text>
      </VStack>
    </GovernanceLayout>
  );
}

export default BilledPage;
