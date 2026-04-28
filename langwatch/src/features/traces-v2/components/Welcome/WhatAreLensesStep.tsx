import {
  Box,
  Flex,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Filter,
  LayoutGrid,
  MessageSquare,
  Plus,
  Sparkles,
  Timer,
} from "lucide-react";
import type React from "react";

import type { WelcomeStepProps } from "./steps";

interface Lens {
  icon: React.ReactNode;
  accent: string;
  name: string;
  desc: string;
}

const LENSES: Lens[] = [
  {
    icon: <LayoutGrid />,
    accent: "blue",
    name: "All",
    desc: "Flat list of every trace",
  },
  {
    icon: <MessageSquare />,
    accent: "green",
    name: "Conversations",
    desc: "Grouped by thread",
  },
  {
    icon: <AlertTriangle />,
    accent: "red",
    name: "Errors",
    desc: "Only traces that errored",
  },
  {
    icon: <Timer />,
    accent: "orange",
    name: "Slow requests",
    desc: "Sorted by duration",
  },
  {
    icon: <CheckCircle2 />,
    accent: "yellow",
    name: "Quality review",
    desc: "Inputs, outputs, and evals",
  },
  {
    icon: <Bot />,
    accent: "purple",
    name: "By Model",
    desc: "Grouped by LLM model",
  },
];

export const WhatAreLensesStep: React.FC<WelcomeStepProps> = () => (
  <VStack align="stretch" gap={5}>
    <Text color="fg.muted" textStyle="sm">
      Six built-ins ship with traces. Tweak one, then click <InlineSaveBadge />{" "}
      to save it as your own.
    </Text>

    <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5}>
      {LENSES.map((lens) => (
        <LensCard key={lens.name} {...lens} />
      ))}
    </SimpleGrid>

    <AiLensCallout />
    <BuiltInsCallout />
  </VStack>
);

const InlineSaveBadge: React.FC = () => (
  <Box
    as="span"
    display="inline-flex"
    alignItems="center"
    justifyContent="center"
    width="18px"
    height="18px"
    borderRadius="sm"
    bg="blue.subtle"
    color="blue.fg"
    verticalAlign="middle"
  >
    <Icon boxSize={3}>
      <Plus />
    </Icon>
  </Box>
);

const LensCard: React.FC<Lens> = ({ icon, name, desc, accent }) => (
  <HStack
    gap={3}
    paddingX={3.5}
    paddingY={2.5}
    borderRadius="md"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    transition="all 0.15s ease"
    _hover={{ borderColor: `${accent}.muted`, background: "bg.panel/70" }}
  >
    <Flex
      flexShrink={0}
      width={8}
      height={8}
      borderRadius="md"
      bg={`${accent}.subtle`}
      color={`${accent}.fg`}
      align="center"
      justify="center"
    >
      <Icon boxSize={4}>{icon}</Icon>
    </Flex>
    <VStack align="stretch" gap={0}>
      <Text textStyle="sm" fontWeight="semibold">
        {name}
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {desc}
      </Text>
    </VStack>
  </HStack>
);

const AiLensCallout: React.FC = () => (
  <HStack
    gap={3}
    align="flex-start"
    borderRadius="md"
    paddingX={4}
    paddingY={3}
    borderWidth="1px"
    borderColor="purple.muted"
    backgroundImage="linear-gradient(135deg, var(--chakra-colors-purple-subtle) 0%, var(--chakra-colors-pink-subtle) 100%)"
  >
    <Icon boxSize={4} color="purple.fg" marginTop={0.5}>
      <Sparkles />
    </Icon>
    <VStack align="stretch" gap={1.5}>
      <Text textStyle="xs" fontWeight="semibold" color="purple.fg">
        Or describe the lens you want
      </Text>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Hit the <InlineSparklesBadge /> in the search bar and ask in plain
        English — &quot;<i>checkout failures from yesterday, grouped by user</i>
        &quot;. The AI builds the filter, columns, sort, and grouping; click{" "}
        <InlineSaveBadge /> to keep it.
      </Text>
    </VStack>
  </HStack>
);

const InlineSparklesBadge: React.FC = () => (
  <Box
    as="span"
    display="inline-flex"
    alignItems="center"
    justifyContent="center"
    width="18px"
    height="18px"
    borderRadius="sm"
    bg="purple.subtle"
    color="purple.fg"
    verticalAlign="middle"
  >
    <Icon boxSize={3}>
      <Sparkles />
    </Icon>
  </Box>
);

const BuiltInsCallout: React.FC = () => (
  <HStack
    gap={3}
    align="flex-start"
    borderRadius="md"
    paddingX={4}
    paddingY={3}
    borderWidth="1px"
    borderColor="blue.muted"
    background="blue.subtle"
  >
    <Icon boxSize={4} color="blue.fg" marginTop={0.5}>
      <Filter />
    </Icon>
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" fontWeight="semibold" color="blue.fg">
        Built-ins are read-only — but duplicable
      </Text>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Right-click any built-in to duplicate it. Custom lenses you own can be
        renamed, saved, reverted, or deleted. A blue dot on a tab means it has
        unsaved changes.
      </Text>
    </VStack>
  </HStack>
);
