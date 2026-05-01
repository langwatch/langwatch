import { Box, Button, HStack, Icon, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import {
  ArrowRight,
  Keyboard,
  RotateCcw,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import type React from "react";
import type { LucideIcon } from "lucide-react";

interface OutroHighlight {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  hint: string;
}

/**
 * The journey itself teaches density, filtering (lenses + facets), the
 * arrival aurora, and the trace drawer — every chapter is the
 * teaching for that thing. The outro panel covers the *highlights
 * that don't get a chapter of their own*: multiplayer presence,
 * keyboard shortcuts, and the integrate path. Three cards keep it a
 * "while you're here" panel rather than a second full tour, which
 * matches the §14 design discussion's framing of the outro as
 * "rest of the highlights" not a third teaching surface.
 *
 * Beta status used to be a separate step in the retired What's-new
 * dialog; folding it into the subhead keeps the panel compact.
 */
const HIGHLIGHTS: OutroHighlight[] = [
  {
    icon: Users,
    iconColor: "blue.fg",
    label: "Multiplayer",
    hint: "Your teammates show up where you do, in real time.",
  },
  {
    icon: Keyboard,
    iconColor: "purple.fg",
    label: "Shortcuts",
    hint: "Hit ? anywhere to see the lot — there are loads.",
  },
  {
    icon: Wrench,
    iconColor: "orange.fg",
    label: "Integrate",
    hint: "Send your own traces — paste a snippet, or hand it to your agent.",
  },
];

interface OutroPanelProps {
  onIntegrate: () => void;
  onDone: () => void;
  onRewatch: () => void;
}

/**
 * Final chapter of the empty-state journey. Replaces the one-line
 * outro hero ("That's the tour.") with a compact panel of three
 * highlight cards plus the exit CTAs.
 *
 * Keep it terse — the journey already did the teaching. The cards
 * are reminders, not lessons; their hints fit on one line each. The
 * primary action is "Send your own traces" (the integrate path) so
 * the user can leave feeling like the next step is theirs to take,
 * not "tour over, now what."
 */
export function OutroPanel({
  onIntegrate,
  onDone,
  onRewatch,
}: OutroPanelProps): React.ReactElement {
  return (
    <VStack align="stretch" gap={4} maxWidth="540px" width="full">
      <VStack align="center" gap={1} textAlign="center">
        <HStack gap={1.5} color="orange.fg">
          <Icon boxSize={4}>
            <Sparkles />
          </Icon>
          <Text textStyle="xs" fontWeight={500} letterSpacing="0.04em">
            That&apos;s the tour
          </Text>
        </HStack>
        <Text color="fg.muted" textStyle="sm" lineHeight={1.6}>
          A few extras worth knowing about — and it&apos;s still beta, so
          ping us when something feels wrong.
        </Text>
      </VStack>

      <SimpleGrid columns={{ base: 1, md: 3 }} gap={2.5}>
        {HIGHLIGHTS.map((h) => (
          <Box
            key={h.label}
            paddingX={3}
            paddingY={2.5}
            borderRadius="lg"
            borderWidth="1px"
            borderColor="border.muted"
            background="bg.panel/60"
          >
            <HStack gap={2} marginBottom={1}>
              <Icon boxSize={3.5} color={h.iconColor}>
                <h.icon />
              </Icon>
              <Text textStyle="sm" fontWeight={500} color="fg">
                {h.label}
              </Text>
            </HStack>
            <Text textStyle="xs" color="fg.muted" lineHeight={1.5}>
              {h.hint}
            </Text>
          </Box>
        ))}
      </SimpleGrid>

      <HStack gap={2.5} justify="center" flexWrap="wrap">
        <Button
          size="md"
          variant="solid"
          colorPalette="orange"
          onClick={onIntegrate}
        >
          <Wrench size={14} />
          Send your own traces
          <ArrowRight size={14} />
        </Button>
        <Button
          size="md"
          variant="ghost"
          colorPalette="gray"
          onClick={onDone}
        >
          Done
        </Button>
      </HStack>

      <HStack justify="center">
        <Button
          variant="plain"
          size="xs"
          color="fg.subtle"
          padding={0}
          minHeight="auto"
          onClick={onRewatch}
          _hover={{ color: "fg.muted" }}
        >
          <Icon boxSize={3}>
            <RotateCcw />
          </Icon>
          Watch the tour again
        </Button>
      </HStack>
    </VStack>
  );
}
