import { Box, Card, Grid, GridItem, Icon, Text, VStack } from "@chakra-ui/react";
import { Telescope, Gavel, GraduationCap, HatGlasses } from "lucide-react";
import { type ProductSelection } from "../../types/types";
import React from "react";

interface ProductOption {
  key: ProductSelection;
  title: string;
  description: string;
  icon: typeof Telescope;
  url?: string;
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
    url: "/@project/evaluations",
  },
  {
    key: "prompt-management",
    title: "Prompt Management",
    description: "Organize, version, iterate, and optimize your prompts.",
    icon: GraduationCap,
    url: "/@project/prompts",
  },
  {
    key: "agent-simulations",
    title: "Agent Simulations",
    description: "Simulate scenarios and test agent behavior.",
    icon: HatGlasses,
    url: "/@project/simulations",
  },
];

interface ProductSelectionScreenProps {
  onSelectProduct: (product: ProductSelection) => void;
}

export const ProductSelectionScreen: React.FC<ProductSelectionScreenProps> = ({
  onSelectProduct,
}) => {

  return (
    <Box position="relative" minH="60vh">
      <Grid
        pt={4}
        templateColumns={{ base: "repeat(1, 1fr)", lg: "repeat(2, 1fr)" }}
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
                onClick={() => {
                  if (opt.url) {
                    window.location.href = opt.url;
                    return;
                  }

                  onSelectProduct(opt.key);
                }}
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

