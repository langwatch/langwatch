import {
  Box,
  Card,
  Grid,
  GridItem,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Code, MessageSquare, Monitor, Terminal } from "lucide-react";
import type React from "react";
import type { ProductSelection } from "../../types/types";

interface ProductOption {
  key: ProductSelection;
  title: string;
  description: string;
  icon: typeof Terminal;
}

const productOptions: ProductOption[] = [
  {
    key: "via-claude-code",
    title: "Via Claude Code",
    description:
      "Set up LangWatch using Claude Code CLI with prompts, skills, or MCP",
    icon: Terminal,
  },
  {
    key: "via-platform",
    title: "Via the Platform",
    description: "Configure directly through the LangWatch dashboard",
    icon: Monitor,
  },
  {
    key: "via-claude-desktop",
    title: "Via Claude Desktop",
    description: "Connect via MCP server in Claude Desktop",
    icon: MessageSquare,
  },
  {
    key: "manually",
    title: "Manually",
    description: "Integrate LangWatch SDK into your codebase manually",
    icon: Code,
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
              onClick={() => onSelectProduct(opt.key)}
            >
              <VStack gap={4} align="center" h="full">
                <Box p={3} borderRadius="xl" bg="orange.50">
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
