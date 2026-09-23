import { Badge, Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { LangyMark, useLangyStore, LangyPanelSurface, SERIF } from "@langwatch/langy-browser-kit";
import { useState } from "react";

import {
  EMPTY_FOLDER_LINE,
  EMPTY_INSIGHTS_COUNTS,
  type InsightsFolder,
  InsightsRail,
} from "../../../features/insights/InsightsRail.tsx";
import {
  DEFAULT_INSIGHTS_SETTINGS,
  InsightsSetupDrawer,
} from "../../../features/insights/InsightsSetupDrawer.tsx";
import GovernanceLayout from "../governance-layout.tsx";

/**
 * Insights placeholder before content. Setup drawer state local (no store yet).
 * Preview badge, no inert controls.
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
            A preview of the inbox where Langy will file the few things worth acting on. Nothing is
            filed yet.
          </Text>
        </VStack>

        <HStack align="start" gap={8} width="full">
          <InsightsRail selected={folder} counts={EMPTY_INSIGHTS_COUNTS} onSelect={setFolder} />
          <Box flex={1} minWidth={0}>
            {folder === "inbox" ? (
              <InboxEmptyBrief onSetup={() => setSetupOpen(true)} onOpenLangy={openLangy} />
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
      {/* Langy's own empty state on Langy's own material — the surface the
            home briefing wears (`langy-root`, hairline, no shadow, dark
            panel palette), with the panel's own empty-state grid: mark,
            serif display line, one sentence, then the keys. No gradient
            defs: outside the Langy panel, currentColor has no paint server. */}
      {/* The surface wraps its card in a full-width scope box, so the
            card centres as a block (auto margins), not as a flex item. */}
      <LangyPanelSurface data-testid="insights-empty-brief" maxWidth="900px" marginX="auto">
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
            A couple of things worth acting on each day, never a feed of fifteen. Nothing has been
            filed here yet.
          </Text>
          {/* Two ways out: Set up data (house button, local state, no mutation yet); Open
              Langy (ghost, changes screen only). */}
          <HStack gap={2} marginTop={6}>
            <PageLayout.HeaderButton onClick={onSetup}>Set up data</PageLayout.HeaderButton>
            <Button size="sm" variant="ghost" onClick={onOpenLangy}>
              Open Langy
            </Button>
          </HStack>
        </VStack>
      </LangyPanelSurface>
    </>
  );
}

export default InsightsPage;
