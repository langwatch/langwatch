import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowRight, Code, MessageSquare, Monitor, Terminal } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { api } from "~/utils/api";
import type { ProductSelection } from "../../types/types";

const MotionBox = motion(Box);

interface ProductOption {
  key: ProductSelection;
  title: string;
  description: string;
  icon: typeof Terminal;
  gradient: string;
}

const productOptions: ProductOption[] = [
  {
    key: "via-claude-code",
    title: "Via Coding Agent",
    description:
      "Set up with prompts, skills, or MCP. Works with Claude Code, Cursor, Windsurf, and more",
    icon: Terminal,
    gradient:
      "linear-gradient(135deg, rgba(237,137,38,0.06) 0%, transparent 50%)",
  },
  {
    key: "via-platform",
    title: "Via the Platform",
    description: "Configure everything directly from the LangWatch dashboard",
    icon: Monitor,
    gradient:
      "linear-gradient(135deg, rgba(49,130,206,0.05) 0%, transparent 50%)",
  },
  {
    key: "via-claude-desktop",
    title: "Via MCP",
    description: "Connect any MCP client. Claude Desktop, ChatGPT, Cursor, Windsurf, and more",
    icon: MessageSquare,
    gradient:
      "linear-gradient(135deg, rgba(128,90,213,0.05) 0%, transparent 50%)",
  },
  {
    key: "manually",
    title: "Manually",
    description: "Integrate the LangWatch SDK directly into your codebase",
    icon: Code,
    gradient:
      "linear-gradient(135deg, rgba(56,161,105,0.05) 0%, transparent 50%)",
  },
];

interface ProductSelectionScreenProps {
  onSelectProduct: (product: ProductSelection) => void;
}

export const ProductSelectionScreen: React.FC<ProductSelectionScreenProps> = ({
  onSelectProduct,
}) => {
  const setIntegrationMethod = api.onboarding.setIntegrationMethod.useMutation();

  return (
    <VStack gap={3} align="stretch" w="full" maxW="520px" mx="auto">
      {productOptions.map((opt, i) => (
        <MotionBox
          as="button"
          key={opt.key}
          w="full"
          position="relative"
          overflow="hidden"
          borderRadius="2xl"
          bg="bg.panel/80"
          border="1px solid"
          borderColor="border.subtle"
          boxShadow="sm"
          backdropFilter="blur(20px) saturate(1.3)"
          px={6}
          py={5}
          cursor="pointer"
          role="button"
          tabIndex={0}
          onClick={() => {
            setIntegrationMethod.mutate({ integrationMethod: opt.key });
            onSelectProduct(opt.key);
          }}
          textAlign="left"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: i * 0.064, ease: "easeOut" }}
          whileHover={{
            y: -3,
            boxShadow:
              "0 12px 40px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)",
            borderColor: "var(--chakra-colors-orange-200)",
            transition: { duration: 0.25, ease: "easeOut" },
          }}
          whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
        >
          {/* Gradient overlay */}
          <Box
            position="absolute"
            inset={0}
            style={{ background: opt.gradient }}
            opacity={0.5}
            transition="opacity 0.3s ease"
            pointerEvents="none"
            css={{
              "button:hover &": { opacity: 1 },
            }}
          />

          <HStack gap={5} align="center" position="relative">
            <Box
              flexShrink={0}
              p={3}
              borderRadius="xl"
              bg="orange.50"
              border="1px solid"
              borderColor="orange.100"
              transition="all 0.25s ease"
              css={{
                "button:hover &": {
                  background: "var(--chakra-colors-orange-100)",
                  borderColor: "var(--chakra-colors-orange-200)",
                  transform: "scale(1.05)",
                },
              }}
            >
              <Icon color="orange.500" boxSize={6}>
                <opt.icon strokeWidth={1.5} />
              </Icon>
            </Box>

            <VStack gap={0.5} align="start" flex={1}>
              <Text
                fontSize="md"
                fontWeight="semibold"
                color="fg.DEFAULT"
                letterSpacing="-0.01em"
              >
                {opt.title}
              </Text>
              <Text fontSize="sm" color="fg.muted" lineHeight="tall">
                {opt.description}
              </Text>
            </VStack>

            <Box
              flexShrink={0}
              color="fg.muted"
              opacity={0}
              transform="translateX(-6px)"
              transition="all 0.25s ease"
              css={{
                "button:hover &": {
                  opacity: 0.5,
                  transform: "translateX(0)",
                },
              }}
            >
              <ArrowRight size={18} />
            </Box>
          </HStack>
        </MotionBox>
      ))}
    </VStack>
  );
};
