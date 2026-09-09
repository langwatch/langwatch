import { Badge, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { BellPlus, Target } from "lucide-react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { Link } from "~/components/ui/link";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The rule registry before there are any rules.
 *
 * A placeholder for the signals that will fire and the alerts that will
 * answer them. Nothing here can create a rule yet, so the page carries the
 * Preview badge and the copy stays in the future tense throughout. The two
 * header buttons still do nothing when pressed; they are owned by the
 * page-header restyle and are not this page's copy to remove.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
function SignalsPage() {
  return (
    <GovernanceLayout pageTitle="Signals & Alerts · AI Governance · LangWatch">
      <VStack align="stretch" gap={8} width="full">
        <HStack justify="space-between" align="start" gap={6}>
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">Signals &amp; Alerts</Heading>
              <Badge colorPalette="purple" size="sm" variant="surface">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted">
              A preview of where signal rules will live: a condition to watch
              for, and what happens when one fires. Nothing is being watched
              yet.
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
            <Text fontWeight="semibold">What this page will hold</Text>
            <Text fontSize="sm" color="fg.muted">
              one registry for the rules that watch your activity. The alerts
              they raise will be listed in the{" "}
              <Link href="/governance/insights">Insights inbox</Link>.
            </Text>
          </HStack>
          <VStack
            data-testid="signals-empty-registry"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            paddingY={14}
            paddingX={6}
          >
            <Text color="fg.muted">
              No rules here yet. Creating one is coming.
            </Text>
          </VStack>
        </VStack>

        <Text fontSize="sm" color="fg.muted">
          A signal that uses a model will run on your organization&apos;s{" "}
          <Link href="/settings/model-providers">model providers</Link>.
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
