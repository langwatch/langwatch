import {
  Badge,
  Box,
  Flex,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MessageCircle, Share2, Users } from "lucide-react";
import type React from "react";

import type { WelcomeStepProps } from "./steps";

type Accent = "teal" | "orange";

interface MultiplayerFeature {
  icon: React.ReactNode;
  accent: Accent;
  title: string;
  body: string;
}

const FEATURES: MultiplayerFeature[] = [
  {
    icon: <Users />,
    accent: "teal",
    title: "Teammate avatars",
    body: "Show up on the lenses and traces your team is currently looking at.",
  },
  {
    icon: <Share2 />,
    accent: "orange",
    title: "Shareable links",
    body: "Send a lens, a filtered view, or a single trace — the link opens to the same state.",
  },
];

export const BetterTogetherStep: React.FC<WelcomeStepProps> = () => (
  <VStack align="stretch" gap={5}>
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
      {FEATURES.map((feature) => (
        <FeatureCard key={feature.title} {...feature} />
      ))}
    </SimpleGrid>
    <ComingSoonCallout />
  </VStack>
);

const FeatureCard: React.FC<MultiplayerFeature> = ({
  icon,
  title,
  body,
  accent,
}) => (
  <VStack
    align="stretch"
    gap={2}
    padding={4}
    borderRadius="lg"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    transition="all 0.15s ease"
    _hover={{ borderColor: "border.emphasized", transform: "translateY(-1px)" }}
  >
    <Flex
      width={9}
      height={9}
      borderRadius="md"
      bg={`${accent}.subtle`}
      color={`${accent}.fg`}
      align="center"
      justify="center"
    >
      <Icon boxSize={4}>{icon}</Icon>
    </Flex>
    <Text textStyle="sm" fontWeight="semibold" letterSpacing="-0.01em">
      {title}
    </Text>
    <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
      {body}
    </Text>
  </VStack>
);

const ComingSoonCallout: React.FC = () => (
  <HStack
    gap={3}
    align="flex-start"
    paddingX={4}
    paddingY={3.5}
    borderRadius="md"
    borderWidth="1px"
    borderStyle="dashed"
    borderColor="pink.muted"
    backgroundImage="linear-gradient(135deg, var(--chakra-colors-pink-subtle) 0%, var(--chakra-colors-purple-subtle) 100%)"
  >
    <Box
      flexShrink={0}
      width={8}
      height={8}
      borderRadius="md"
      bg="pink.subtle"
      color="pink.fg"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <Icon boxSize={4}>
        <MessageCircle />
      </Icon>
    </Box>
    <VStack align="stretch" gap={1.5}>
      <HStack gap={2}>
        <Text textStyle="xs" fontWeight="semibold" color="pink.fg">
          Live cursors &amp; threaded comments
        </Text>
        <Badge
          colorPalette="pink"
          variant="surface"
          size="xs"
          borderRadius="full"
        >
          Coming soon
        </Badge>
      </HStack>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Comment on a span, see a teammate&apos;s cursor as they scroll through a
        trace, and resolve threads when the bug is fixed.
      </Text>
    </VStack>
  </HStack>
);
