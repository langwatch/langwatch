import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  DEFAULT_INSIGHTS_SETTINGS,
  InsightsSetupDialog,
} from "~/components/governance/platform/InsightsSetupDialog";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { LangyMark } from "~/features/langy/components/LangyMark";
import { useLangyStore } from "~/features/langy/stores/langyStore";

/**
 * The Insights inbox before there is anything in it.
 *
 * A placeholder for the brief Langy will write: one card that says what
 * will land here and offers the two ways in. The Setup dialog's values
 * live in this page's state for the sitting and nowhere else — there is
 * no store behind them yet, and nothing here says otherwise.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
function InsightsPage() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_INSIGHTS_SETTINGS);

  return (
    <GovernanceLayout pageTitle="Insights · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={1}>
          <Heading size="md">Insights</Heading>
          <Text color="fg.muted">
            Langy&apos;s brief: a few things worth acting on, kept fresh, never
            a feed. Alerts and notifications ride on top.
          </Text>
        </VStack>

        <VStack
          data-testid="insights-empty-brief"
          alignSelf="center"
          width="full"
          maxWidth="900px"
          gap={5}
          paddingY={20}
          paddingX={8}
          borderWidth="2px"
          borderStyle="dashed"
          borderColor="border.subtle"
          borderRadius="xl"
        >
          <Box
            background="fg"
            borderRadius="xl"
            width="72px"
            height="72px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <LangyMark size={36} />
          </Box>
          <Heading size="lg" textAlign="center">
            Langy writes your brief here
          </Heading>
          <Text color="fg.muted" textAlign="center" maxWidth="640px">
            Every morning a background job reads yesterday&apos;s traffic and
            files a couple of high-signal insights: not fifteen a day.
          </Text>
          <HStack gap={3} paddingTop={2}>
            <Button colorPalette="orange" onClick={() => setSetupOpen(true)}>
              Set up data
            </Button>
            <Button
              variant="subtle"
              onClick={() => useLangyStore.getState().openPanel()}
            >
              Open Langy
            </Button>
          </HStack>
          <Button variant="plain" size="sm" color="fg.muted">
            or preview a sample inbox
          </Button>
        </VStack>
      </VStack>

      <InsightsSetupDialog
        open={setupOpen}
        settings={settings}
        onCancel={() => setSetupOpen(false)}
        onSave={(next) => {
          setSettings(next);
          setSetupOpen(false);
        }}
      />
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
    })(InsightsPage),
  ),
);
