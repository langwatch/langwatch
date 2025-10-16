import React from "react";
import { VStack, Card, Text, Icon, Box, Grid, GridItem } from "@chakra-ui/react";
import { Telescope, Gavel, GraduationCap, HatGlasses } from "lucide-react";
import { OnboardingMeshBackground } from "../components/OnboardingMeshBackground";
import {
  type OnboardingScreen,
  type ProductSelection,
  ProductScreenIndex,
} from "../types/types";

interface ProductOption {
  key: ProductSelection;
  title: string;
  description: string;
  icon: typeof Telescope;
}

const productOptions: ProductOption[] = [
  {
    key: "observability",
    title: "Observability",
    description: "Set up SDKs and start seeing traces and analytics.",
    icon: Telescope,
  },
  {
    key: "evaluations",
    title: "Evaluations",
    description: "Create and run evaluations to measure quality.",
    icon: Gavel,
  },
  {
    key: "prompt-management",
    title: "Prompt Management",
    description: "Organize, version, iterate, and optimize your prompts.",
    icon: GraduationCap,
  },
  {
    key: "agent-simulations",
    title: "Agent Simulations",
    description: "Simulate scenarios and test agent behavior.",
    icon: HatGlasses,
  },
];

interface ProductScreensProps {
  selectedProduct: ProductSelection | undefined;
  onSelectProduct: (product: ProductSelection) => void;
}

export function createProductScreens({
  selectedProduct,
  onSelectProduct,
}: ProductScreensProps): OnboardingScreen[] {
  const ProductSelectionScreen: React.FC = () => {
    return (
      <Box position="relative" minH="60vh">
        <OnboardingMeshBackground opacity={0.22} blurPx={96} />
        <Grid
          pt={4}
          templateColumns="repeat(2, 1fr)"
          gap={4}
          position="relative"
          zIndex={1}
        >
          {productOptions.map((opt) => (
            <GridItem key={opt.key}>
              <Card.Root asChild h="full">
                <Box
                  as="button"
                  w="full"
                  h="full"
                  borderWidth="1px"
                  borderColor="border.emphasized/40"
                  borderRadius="md"
                  p={6}
                  bg="bg.subtle/30"
                  backdropFilter="blur(10px)"
                  cursor="pointer"
                  transition="all 0.2s"
                  position="relative"
                  _hover={{
                    bg: "bg.subtle/70",
                    transform: "translateY(-2px)",
                    borderColor: "border.subtle/70",
                  }}
                  onClick={() => onSelectProduct(opt.key)}
                >
                  <VStack gap={3} align="center" h="full">
                    <Icon color="orange.500" size="2xl">
                      <opt.icon strokeWidth={1.75} />
                    </Icon>
                    <VStack gap={1}>
                      <Text textStyle="lg" fontWeight="semibold" color="fg.emphasized" textAlign="center">
                        {opt.title}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" textAlign="center" alignSelf="stretch" flex={1}>
                        {opt.description}
                      </Text>
                    </VStack>
                  </VStack>
                </Box>
              </Card.Root>
            </GridItem>
          ))}
        </Grid>
      </Box>
    );
  };

  const ObservabilityScreen: React.FC = () => {
    return (
      <VStack gap={4} align="stretch">
        <Text>Coming soon - Observability onboarding content.</Text>
      </VStack>
    );
  };

  const EvaluationsScreen: React.FC = () => {
    return (
      <VStack gap={4} align="stretch">
        <Text>Coming soon - Evaluations onboarding content.</Text>
      </VStack>
    );
  };

  const PromptManagementScreen: React.FC = () => {
    return (
      <VStack gap={4} align="stretch">
        <Text>Coming soon - Prompt Management onboarding content.</Text>
      </VStack>
    );
  };

  const AgentSimulationsScreen: React.FC = () => {
    return (
      <VStack gap={4} align="stretch">
        <Text>Coming soon - Agent Simulations onboarding content.</Text>
      </VStack>
    );
  };

  const screens: Record<ProductScreenIndex, OnboardingScreen> = {
    [ProductScreenIndex.SELECTION]: {
      id: "product-selection",
      required: false,
      heading: "Pick your flavour",
      subHeading: "Choose a starting point. You can explore the rest anytime.",
      component: <ProductSelectionScreen />,
    },
    [ProductScreenIndex.OBSERVABILITY]: {
      id: "observability",
      required: false,
      heading: "Observability",
      subHeading: "Get started with SDK setup and integration",
      component: <ObservabilityScreen />,
    },
    [ProductScreenIndex.EVALUATIONS]: {
      id: "evaluations",
      required: false,
      heading: "Evaluations",
      subHeading: "Create and run your first evaluation",
      component: <EvaluationsScreen />,
    },
    [ProductScreenIndex.PROMPT_MANAGEMENT]: {
      id: "prompt-management",
      required: false,
      heading: "Prompt Management",
      subHeading: "Organize and iterate on prompts",
      component: <PromptManagementScreen />,
    },
    [ProductScreenIndex.AGENT_SIMULATIONS]: {
      id: "agent-simulations",
      required: false,
      heading: "Agent Simulations",
      subHeading: "Simulate scenarios and test agents",
      component: <AgentSimulationsScreen />,
    },
  };

  // Return screens based on flow config
  if (selectedProduct) {
    const productScreenMap: Record<ProductSelection, ProductScreenIndex> = {
      observability: ProductScreenIndex.OBSERVABILITY,
      evaluations: ProductScreenIndex.EVALUATIONS,
      "prompt-management": ProductScreenIndex.PROMPT_MANAGEMENT,
      "agent-simulations": ProductScreenIndex.AGENT_SIMULATIONS,
    };

    return [
      screens[ProductScreenIndex.SELECTION],
      screens[productScreenMap[selectedProduct]],
    ];
  }

  return [screens[ProductScreenIndex.SELECTION]];
}

