import { Box, Flex, HStack, Heading, Icon, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Layers, LayoutGrid, Zap } from "lucide-react";
import type React from "react";

type Accent = "purple" | "blue" | "orange";

interface Feature {
  icon: React.ReactNode;
  accent: Accent;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: <Layers />,
    accent: "purple",
    title: "Lens-based views",
    body: "Switch context with a tab — columns, filters, sort, and grouping all baked in.",
  },
  {
    icon: <LayoutGrid />,
    accent: "blue",
    title: "One screen, three panels",
    body: "Filters, results, and the trace drawer side by side. No more page hops.",
  },
  {
    icon: <Zap />,
    accent: "orange",
    title: "Live, dense, formatted",
    body: "Live-tail, density toggle, and rules that highlight the rows you care about.",
  },
];

export const WhatsChangedStep: React.FC = () => (
  <VStack align="stretch" gap={5}>
    <LayoutPreview />
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
      {FEATURES.map((feature) => (
        <FeatureCard key={feature.title} {...feature} />
      ))}
    </SimpleGrid>
  </VStack>
);

const PREVIEW_TABS = [
  { label: "All", active: true },
  { label: "Conversations" },
  { label: "Errors" },
  { label: "By Model" },
];

const LayoutPreview: React.FC = () => (
  <Box
    borderRadius="lg"
    borderWidth="1px"
    borderColor="border.muted"
    background="bg.panel/40"
    overflow="hidden"
    height="160px"
  >
    <Flex
      align="center"
      gap={1.5}
      paddingX={3}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
    >
      <Box width="6px" height="6px" borderRadius="full" bg="red.400" />
      <Box width="6px" height="6px" borderRadius="full" bg="yellow.400" />
      <Box width="6px" height="6px" borderRadius="full" bg="green.400" />
      <HStack gap={1.5} marginLeft={3}>
        {PREVIEW_TABS.map((tab) => (
          <FauxTab key={tab.label} label={tab.label} active={tab.active} />
        ))}
      </HStack>
    </Flex>
    <HStack gap={0} align="stretch" height="calc(100% - 30px)">
      <Box width="22%" borderRightWidth="1px" borderColor="border.muted" padding={2}>
        <FauxLine width="60%" />
        <FauxLine width="80%" muted />
        <FauxLine width="50%" muted />
        <FauxLine width="70%" muted />
      </Box>
      <Box flex={1} padding={2}>
        <FauxLine width="40%" />
        <FauxLine width="90%" muted />
        <FauxLine width="85%" muted />
        <FauxLine width="92%" muted />
        <FauxLine width="78%" muted />
      </Box>
      <Box
        width="28%"
        borderLeftWidth="1px"
        borderColor="border.muted"
        padding={2}
        bg="bg.subtle"
      >
        <FauxLine width="70%" />
        <FauxLine width="50%" muted />
        <FauxLine width="60%" muted />
        <FauxLine width="40%" muted />
      </Box>
    </HStack>
  </Box>
);

interface FauxTabProps {
  label: string;
  active?: boolean;
}

const FauxTab: React.FC<FauxTabProps> = ({ label, active }) => (
  <Box
    paddingX={2}
    paddingY={0.5}
    borderRadius="sm"
    textStyle="2xs"
    fontWeight={active ? "semibold" : "medium"}
    color={active ? "blue.fg" : "fg.muted"}
    borderBottomWidth={active ? "2px" : "0"}
    borderColor="blue.solid"
  >
    {label}
  </Box>
);

interface FauxLineProps {
  width: string;
  muted?: boolean;
}

const FauxLine: React.FC<FauxLineProps> = ({ width, muted }) => (
  <Box
    height="6px"
    width={width}
    borderRadius="sm"
    bg={muted ? "border.muted" : "border.emphasized"}
    marginBottom={1.5}
  />
);

const FeatureCard: React.FC<Feature> = ({ icon, title, body, accent }) => (
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
    <Heading size="sm" letterSpacing="-0.01em">
      {title}
    </Heading>
    <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
      {body}
    </Text>
  </VStack>
);
