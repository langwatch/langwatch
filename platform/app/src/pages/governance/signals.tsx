import { Badge, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { BellPlus, Plus } from "lucide-react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The rule registry before there are any rules.
 *
 * A placeholder for the signals that will fire and the alerts that will
 * answer them. Nothing here can create a rule yet, so the page carries the
 * Preview badge and the copy stays in the future tense throughout. The two
 * header buttons are shown disabled for the same reason: they draw the
 * header's shape and name what is coming, and disabled is the one honest
 * way to offer a control with nothing behind it.
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
            {/* Neither of these buttons has a handler, so both are
                disabled: enabled and inert reads as broken, disabled reads
                as not yet built, and the second one is the truth. They stay
                on the page so the header keeps its shape and the reader can
                see what is coming.
                They are weighted anyway, by the page-header rule: one
                outlined, the rest ghost. New signal takes the outline
                because the screen is named for signals and that is the
                control that would become the create action once one exists,
                not because it does more than its neighbour today. Both were
                solid orange before the sweep, which read as two competing
                create actions on a page that has none.

                A parallel copy change on this page says rule creation is
                still coming. That is consistent with these buttons rather
                than contradicted by them: they are placeholders. If you do
                not find such a sentence, it has not landed yet or has been
                reworded, which changes nothing here. */}
            <Button size="sm" variant="ghost" disabled>
              <BellPlus size={14} />
              New alert
            </Button>
            <PageLayout.HeaderButton disabled>
              <Plus size={14} />
              New signal
            </PageLayout.HeaderButton>
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
