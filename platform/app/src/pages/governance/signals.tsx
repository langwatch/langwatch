import { Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { BellPlus, Target } from "lucide-react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { Link } from "~/components/ui/link";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The rule registry before there are any rules.
 *
 * A placeholder for the signals that fire and the alerts and automations
 * that answer them. Nothing here can create a rule yet; the two header
 * buttons draw the shape of the screen and do nothing when pressed.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
function SignalsPage() {
  return (
    <GovernanceLayout pageTitle="Signals & Alerts · AI Governance · LangWatch">
      <VStack align="stretch" gap={8} width="full">
        <HStack justify="space-between" align="start" gap={6}>
          <VStack align="start" gap={1}>
            <Heading size="md">Signals &amp; Alerts</Heading>
            <Text color="fg.muted">
              A signal is the condition: a judge, a metric or a query. Alerts
              and automations are what happens when one fires: who gets told,
              what gets done.
            </Text>
          </VStack>
          <HStack gap={2} flexShrink={0}>
            <Button variant="outline">
              <BellPlus size={16} />
              New alert
            </Button>
            <Button colorPalette="orange">
              <Target size={16} />
              New signal
            </Button>
          </HStack>
        </HStack>

        <VStack align="stretch" gap={3}>
          <HStack gap={2} align="baseline" flexWrap="wrap">
            <Text fontWeight="semibold">When a signal fires</Text>
            <Text fontSize="sm" color="fg.muted">
              alerts notify, automations act: one registry of rules. Recent
              fires land in the{" "}
              <Link href="/governance/insights">Insights inbox</Link>.
            </Text>
          </HStack>
          <VStack
            data-testid="signals-empty-registry"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="lg"
            paddingY={14}
            paddingX={6}
          >
            <Text color="fg.muted">
              No rules scoped here yet. Create one from any chart&apos;s bell
              icon.
            </Text>
          </VStack>
        </VStack>

        <Text fontSize="sm" color="fg.muted">
          Judges run on the org&apos;s{" "}
          <Link href="/settings/model-providers">model providers</Link> (the
          same credentials the Gateway routes through).
        </Text>
      </VStack>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withFeatureFlagGuard("release_ui_governance_billed_cost_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governance:view", {
      bypassOnboardingRedirect: true,
    })(SignalsPage),
  ),
);
