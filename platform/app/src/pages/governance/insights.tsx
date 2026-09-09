import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  EMPTY_FOLDER_LINE,
  EMPTY_INSIGHTS_COUNTS,
  type InsightsFolder,
  InsightsRail,
} from "~/components/governance/platform/InsightsRail";
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
 * no store behind them yet, and nothing here says otherwise. The page
 * carries the Preview badge and offers no control that cannot act.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
function InsightsPage() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_INSIGHTS_SETTINGS);
  const [folder, setFolder] = useState<InsightsFolder>("inbox");
  const openLangy = useLangyStore((state) => state.openPanel);

  return (
    <GovernanceLayout pageTitle="Insights · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={1}>
          <HStack gap={2}>
            <Heading size="md">Insights</Heading>
            <Badge colorPalette="purple" size="sm" variant="surface">
              Preview
            </Badge>
          </HStack>
          <Text color="fg.muted">
            A preview of the inbox where Langy will file the few things worth
            acting on. Nothing is filed yet.
          </Text>
        </VStack>

        <HStack align="start" gap={8} width="full">
          <InsightsRail
            selected={folder}
            counts={EMPTY_INSIGHTS_COUNTS}
            onSelect={setFolder}
          />
          <Box flex={1} minWidth={0}>
            {folder === "inbox" ? (
              <InboxEmptyBrief
                onSetup={() => setSetupOpen(true)}
                onOpenLangy={openLangy}
              />
            ) : (
              <Text color="fg.muted" paddingY={4}>
                {EMPTY_FOLDER_LINE[folder]}
              </Text>
            )}
          </Box>
        </HStack>
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

function InboxEmptyBrief({
  onSetup,
  onOpenLangy,
}: {
  onSetup: () => void;
  onOpenLangy: () => void;
}) {
  return (
    <>
      {/* Langy's own empty state on Langy's own material. The surface is
            the one the home briefing wears (`langy-root`, hairline, no
            shadow, the panel's palette in dark); inside it, the panel's
            empty-state grammar: the bare mark, the serif display line, one
            quiet sentence, then the keys — see
            features/langy/components/EmptyState.tsx. The scope also paints
            the mark in currentColor (langyTheme.css), which is why the card
            carries no gradient defs: outside it the mark would fill from a
            paint server only the Langy panel mounts. */}
      {/* The surface wraps its card in a full-width scope box, so the
            card centres as a block (auto margins), not as a flex item. */}
      <LangyPanelSurface
        data-testid="insights-empty-brief"
        maxWidth="900px"
        marginX="auto"
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
            Langy will write your brief here
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
            A couple of things worth acting on each day, never a feed of
            fifteen. Nothing has been filed here yet.
          </Text>
          <HStack gap={2} marginTop={6}>
            <Button size="sm" colorPalette="orange" onClick={onSetup}>
              Set up data
            </Button>
            <Button size="sm" variant="subtle" onClick={onOpenLangy}>
              Open Langy
            </Button>
          </HStack>
        </VStack>
      </LangyPanelSurface>
    </>
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
