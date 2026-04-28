import { Box, Flex, HStack, Icon, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import {
  AlertTriangle,
  Bot,
  Filter,
  LayoutGrid,
  MessageSquare,
  Plus,
  Server,
  Users,
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
  { icon: <LayoutGrid />,    accent: "blue",   name: "All Traces",    desc: "The flat list — no grouping" },
  { icon: <MessageSquare />, accent: "green",  name: "Conversations", desc: "Grouped by thread" },
  { icon: <AlertTriangle />, accent: "red",    name: "Errors",        desc: "Only traces with errors" },
  { icon: <Bot />,           accent: "purple", name: "By Model",      desc: "Grouped by LLM model" },
  { icon: <Server />,        accent: "cyan",   name: "By Service",    desc: "Grouped by service name" },
  { icon: <Users />,         accent: "orange", name: "By User",       desc: "Grouped by user ID" },
];

export const WhatAreLensesStep: React.FC<WelcomeStepProps> = () => (
  <VStack align="stretch" gap={5}>
    <Text color="fg.muted" textStyle="sm">
      Six built-ins ship with traces. Tweak one, then click{" "}
      <InlineSaveBadge />{" "}
      to save it as your own.
    </Text>

    <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5}>
      {LENSES.map((lens) => (
        <LensCard key={lens.name} {...lens} />
      ))}
    </SimpleGrid>

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
