import {
  Box,
  Card,
  Grid,
  GridItem,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Gavel, GraduationCap, HatGlasses, Telescope } from "lucide-react";
import type React from "react";
import type { ProductSelection } from "../../types/types";

type ProductOption =
  | {
      key: ProductSelection;
      title: string;
      description: string;
      icon: typeof Telescope;
    }
  | {
      key: "agent-simulations";
      title: string;
      description: string;
      icon: typeof HatGlasses;
      url: string;
    };

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
    <Grid
      templateColumns={{ base: "repeat(1, 1fr)", md: "repeat(2, 1fr)" }}
      gap={4}
    >
      {productOptions.map((opt) => (
        <GridItem key={opt.key}>
          <Card.Root asChild h="full">
            <Box
              as="button"
              w="full"
              h="full"
              borderRadius="2xl"
              bg="bg.panel"
              border="1px solid"
              borderColor="border.muted"
              boxShadow="xs"
              p={8}
              cursor="pointer"
              transition="all 0.2s ease-in-out"
              _hover={{
                boxShadow: "sm",
                transform: "translateY(-2px)",
                borderColor: "border.emphasized",
              }}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (opt.key === "agent-simulations") {
                  window.location.href = opt.url;
                  return;
                }

                onSelectProduct(opt.key);
              }}
            >
              <VStack gap={4} align="center" h="full">
                <Box
                  p={3}
                  borderRadius="xl"
                  bg="orange.50"
                >
                  <Icon color="orange.500" boxSize={6}>
                    <opt.icon strokeWidth={1.75} />
                  </Icon>
                </Box>
                <VStack gap={1}>
                  <Text
                    textStyle="md"
                    fontWeight="semibold"
                    color="fg.DEFAULT"
                    textAlign="center"
                  >
                    {opt.title}
                  </Text>
                  <Text
                    fontSize="sm"
                    color="fg.muted"
                    textAlign="center"
                    lineHeight="tall"
                  >
                    {opt.description}
                  </Text>
                </VStack>
              </VStack>
            </Box>
          </Card.Root>
        </GridItem>
      ))}
    </Grid>
  );
};
