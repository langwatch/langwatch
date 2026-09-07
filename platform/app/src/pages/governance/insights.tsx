import { Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  DEFAULT_INSIGHTS_SETTINGS,
  InsightsSetupDrawer,
} from "~/components/governance/platform/InsightsSetupDrawer";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { LangyPanelSurface } from "~/features/asaplangy/components/LangyPanelSurface";
import { SERIF } from "~/features/asaplangy/tokens";
import { LangyMark } from "~/features/langy/components/LangyMark";
import { useLangyStore } from "~/features/langy/stores/langyStore";

/**
 * The Insights inbox before there is anything in it.
 *
 * A placeholder for the brief Langy will write: one card that says what
 * will land here and offers the two ways in. The Setup drawer's values
 * live in this page's state for the sitting and nowhere else — there is
 * no store behind them yet, and nothing here says otherwise.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
function InsightsPage() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_INSIGHTS_SETTINGS);
  const openLangy = useLangyStore((state) => state.openPanel);

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

        {/* Langy's own empty state on Langy's own material. The surface is
            the one the home briefing wears (`langy-root`, hairline, no
            shadow, the panel's palette in dark); inside it, the panel's
            empty-state grammar: the bare mark, the serif display line, one
            quiet sentence, then the keys — see
            features/langy/components/EmptyState.tsx. The scope also paints
            the mark in currentColor (langyTheme.css), which is why the card
            carries no gradient defs: outside it the mark would fill from a
            paint server only the Langy panel mounts. */}
        <LangyPanelSurface
          data-testid="insights-empty-brief"
          alignSelf="center"
          maxWidth="900px"
        >
          <VStack gap={0} paddingY={16} paddingX={8}>
            <LangyMark size={44} />
            <Text
              as="h2"
              fontFamily={SERIF}
              // 44px mark ÷ φ, the same pairing the panel's greeting uses.
              fontSize="27px"
              fontWeight="500"
              letterSpacing="-0.02em"
              lineHeight="1.2"
              color="fg"
              textAlign="center"
              marginTop={4}
            >
              Langy writes your brief here
            </Text>
            <Text
              textStyle="sm"
              color="fg.muted"
              lineHeight="1.5"
              textAlign="center"
              textWrap="balance"
              maxWidth="380px"
              marginTop={2}
            >
              Every morning a background job reads yesterday&apos;s traffic and
              files a couple of high-signal insights: not fifteen a day.
            </Text>
            <HStack gap={2} marginTop={6}>
              <Button
                size="sm"
                colorPalette="orange"
                onClick={() => setSetupOpen(true)}
              >
                Set up data
              </Button>
              <Button size="sm" variant="subtle" onClick={openLangy}>
                Open Langy
              </Button>
            </HStack>
            <Button
              variant="plain"
              size="xs"
              fontWeight="400"
              color="fg.subtle"
              marginTop={3}
            >
              or preview a sample inbox
            </Button>
          </VStack>
        </LangyPanelSurface>
      </VStack>

      <InsightsSetupDrawer
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
