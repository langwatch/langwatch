import { Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  DEFAULT_INSIGHTS_SETTINGS,
  InsightsSetupDialog,
} from "~/components/governance/platform/InsightsSetupDialog";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import {
  LangyMark,
  LangyMarkGradientDefs,
} from "~/features/langy/components/LangyMark";
import { useLangyStore } from "~/features/langy/stores/langyStore";

/**
 * Own paint server for the mark. The Langy panel mounts the shared one,
 * but a viewer without Langy never has it, and a mark filled from a missing
 * gradient paints nothing.
 */
const INSIGHTS_MARK_GRADIENT_ID = "governance-insights-mark-grad";

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

        {/* Langy's own empty state, transplanted: the bare mark, the serif
            display line under it, one quiet sentence, then the keys. No tile
            behind the mark, one hairline, no shadow — see
            features/langy/components/EmptyState.tsx and langyTheme.ts for
            why each of those is a rule and not a taste. `langy-root` scopes
            Langy's type face and dark palette to the card. */}
        <VStack
          className="langy-root"
          data-testid="insights-empty-brief"
          alignSelf="center"
          width="full"
          maxWidth="900px"
          gap={0}
          paddingY={16}
          paddingX={8}
          borderWidth="1px"
          borderStyle="dashed"
          borderColor="border"
          borderRadius="xl"
          background="bg.surface"
        >
          <LangyMarkGradientDefs id={INSIGHTS_MARK_GRADIENT_ID} />
          <LangyMark size={44} gradientId={INSIGHTS_MARK_GRADIENT_ID} />
          <Text
            as="h2"
            fontFamily="var(--langy-font-serif)"
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
