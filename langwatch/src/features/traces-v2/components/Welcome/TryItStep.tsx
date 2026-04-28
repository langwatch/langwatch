import {
  Box,
  Heading,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";

import { Kbd } from "~/components/ops/shared/Kbd";

import type { WelcomeStepProps } from "./steps";

interface Shortcut {
  keys: React.ReactNode;
  label: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: <Kbd>[</Kbd>, label: "Collapse the filter sidebar" },
  {
    keys: (
      <HStack gap={1}>
        <Kbd>⌘</Kbd>
        <Kbd>F</Kbd>
      </HStack>
    ),
    label: "Find inside loaded traces",
  },
  { keys: <Kbd>O</Kbd>, label: "Open trace in full view" },
  { keys: <Kbd>Esc</Kbd>, label: "Close the trace drawer" },
];

export const TryItStep: React.FC<WelcomeStepProps> = () => (
  <VStack align="stretch" gap={5}>
    <ShortcutsSection />
    <RecallTourSection />
    <BetaCallout />
  </VStack>
);

const ShortcutsSection: React.FC = () => (
  <VStack align="stretch" gap={2.5}>
    <Heading size="sm" letterSpacing="-0.01em">
      Shortcuts
    </Heading>
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5}>
      {SHORTCUTS.map((shortcut) => (
        <ShortcutRow key={shortcut.label} {...shortcut} />
      ))}
    </SimpleGrid>
  </VStack>
);

const RecallTourSection: React.FC = () => (
  <VStack align="stretch" gap={2}>
    <Heading size="sm" letterSpacing="-0.01em">
      Reopen this tour
    </Heading>
    <Text textStyle="sm" color="fg.muted">
      Under the <WhatsNewBadge /> button in the toolbar.
    </Text>
  </VStack>
);

const WhatsNewBadge: React.FC = () => (
  <Box
    as="span"
    display="inline-flex"
    alignItems="center"
    gap={1}
    paddingX={1.5}
    paddingY={0.5}
    borderRadius="sm"
    borderWidth="1px"
    borderColor="border.muted"
    bg="bg.panel"
    textStyle="xs"
    fontWeight="medium"
    verticalAlign="middle"
  >
    <Icon boxSize={3} color="purple.fg">
      <Sparkles />
    </Icon>
    What&apos;s new
  </Box>
);

const BetaCallout: React.FC = () => (
  <HStack
    gap={3}
    align="flex-start"
    paddingX={4}
    paddingY={3.5}
    borderRadius="md"
    borderWidth="1px"
    borderColor="purple.muted"
    backgroundImage="linear-gradient(135deg, var(--chakra-colors-purple-subtle) 0%, var(--chakra-colors-pink-subtle) 100%)"
  >
    <Icon boxSize={4} color="purple.fg" marginTop={0.5}>
      <Sparkles />
    </Icon>
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" fontWeight="semibold" color="purple.fg">
        This is beta
      </Text>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Things will change. If you hit something rough, send us feedback.
      </Text>
    </VStack>
  </HStack>
);

const ShortcutRow: React.FC<Shortcut> = ({ keys, label }) => (
  <HStack
    gap={3}
    paddingX={3}
    paddingY={2}
    borderRadius="md"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
  >
    <Box flexShrink={0}>{keys}</Box>
    <Text textStyle="xs" color="fg.muted">
      {label}
    </Text>
  </HStack>
);
