import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import { ArrowRight, Sparkles, Wrench, X } from "lucide-react";
import type React from "react";

interface OutroPanelProps {
  onIntegrate: () => void;
  onDone: () => void;
  /**
   * Kept on the props so callers don't have to change shape — the
   * inline banner doesn't render a "watch again" link itself
   * (re-entry lives on the toolbar's Tour button), so this is unused
   * here. Removed from the runtime args list with an underscore to
   * make the intent explicit.
   */
  onRewatch?: () => void;
}

/**
 * Final beat of the empty-state journey. Replaces the previous
 * full-card overlay with a thin top banner so the live table is
 * visible underneath without row-text bleed. Visual job:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ✨ Tour done — explore freely.   [Send your own traces ↗] ✕│
 *   └──────────────────────────────────────────────────────────┘
 *
 * Kept terse on purpose: the journey already did the teaching, the
 * highlight cards (multiplayer / shortcuts / docs) sit elsewhere in
 * the app, and stacking a "rest of the highlights" panel on top of
 * the live table after the user has already finished the tour reads
 * as in-the-way. The single primary action is "send your own
 * traces" so the next step still feels like the user's to take.
 */
export function OutroPanel({
  onIntegrate,
  onDone,
}: OutroPanelProps): React.ReactElement {
  return (
    <Box
      width="full"
      maxWidth="780px"
      paddingX={{ base: 3, md: 4 }}
      paddingY={2}
      borderRadius="full"
      borderWidth="1px"
      borderColor="border.muted"
      background="bg.panel/85"
      backdropFilter="blur(8px)"
      boxShadow="sm"
    >
      <HStack gap={3} justify="space-between" flexWrap="wrap">
        <HStack gap={2} flex={1} minWidth="0">
          <Icon boxSize={3.5} color="orange.fg">
            <Sparkles />
          </Icon>
          <Text textStyle="sm" fontWeight={500} color="fg" truncate>
            Tour done — explore freely.
          </Text>
        </HStack>

        <HStack gap={2} flexShrink={0}>
          <Button
            size="sm"
            variant="solid"
            colorPalette="orange"
            onClick={onIntegrate}
          >
            <Wrench size={13} />
            Send your own traces
            <ArrowRight size={13} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            colorPalette="gray"
            onClick={onDone}
            aria-label="Dismiss tour banner"
          >
            <Icon boxSize={3.5}>
              <X />
            </Icon>
          </Button>
        </HStack>
      </HStack>
    </Box>
  );
}
