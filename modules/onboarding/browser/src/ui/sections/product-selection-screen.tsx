import { Box, HStack, Icon, Text, VStack } from "@langwatch/design-system/primitives";
import { ArrowRight, Code, MessageSquare, Monitor, Terminal } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";

import { api } from "../../behavior/onboarding-api.ts";
import type { ProductSelection } from "../../behavior/types.ts";
import { accentChipBg, accentChipBorder } from "../../model/shared/accent-surface.ts";

const MotionBox = motion.create(Box);

interface ProductOption {
  key: ProductSelection;
  title: string;
  description: string;
  icon: typeof Terminal;
  gradient: string;
}

const productOptions: ProductOption[] = [
  {
    key: "via-platform",
    title: "Via the Platform",
    description: "Configure everything directly from the LangWatch dashboard",
    icon: Monitor,
    gradient:
      "linear-gradient(135deg, color-mix(in srgb, var(--chakra-colors-blue-solid) 5%, transparent) 0%, transparent 50%)",
  },
  {
    key: "via-claude-code",
    title: "Via Coding Agent",
    description:
      "Set up with prompts, skills, or MCP. Works with Claude Code, Cursor, Windsurf, and more",
    icon: Terminal,
    gradient:
      "linear-gradient(135deg, color-mix(in srgb, var(--chakra-colors-accent-solid) 6%, transparent) 0%, transparent 50%)",
  },
  {
    key: "via-claude-desktop",
    title: "Via MCP",
    description: "Connect any MCP client. Claude Desktop, ChatGPT, Cursor, Windsurf, and more",
    icon: MessageSquare,
    gradient:
      "linear-gradient(135deg, color-mix(in srgb, var(--chakra-colors-purple-solid) 5%, transparent) 0%, transparent 50%)",
  },
  {
    key: "manually",
    title: "Manually",
    description: "Integrate the LangWatch SDK directly into your codebase",
    icon: Code,
    gradient:
      "linear-gradient(135deg, color-mix(in srgb, var(--chakra-colors-green-solid) 5%, transparent) 0%, transparent 50%)",
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
          borderColor={{ base: "orange.emphasized", _dark: "orange.emphasized" }}
          boxShadow="sm"
          backdropFilter="blur(20px) saturate(1.3)"
          px={6}
          py={5}
          cursor="pointer"
          onClick={() => {
            setIntegrationMethod.mutate({ integrationMethod: opt.key });
            onSelectProduct(opt.key);
          }}
          textAlign="left"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.27, delay: i * 0.054, ease: "easeOut" }}
          whileHover={{
            y: -3,
            boxShadow:
              "0 12px 40px color-mix(in srgb, var(--chakra-colors-bg-scrim) 8%, transparent), 0 2px 6px color-mix(in srgb, var(--chakra-colors-bg-scrim) 4%, transparent)",
            borderColor: "var(--chakra-colors-orange-emphasized)",
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
              bg={accentChipBg}
              border="1px solid"
              borderColor={accentChipBorder}
              transition="all 0.25s ease"
              // Semantic variables keep the nested hover selector mode-aware.
              css={{
                "button:hover &": {
                  background: "var(--chakra-colors-accent-muted)",
                  borderColor: "var(--chakra-colors-orange-emphasized)",
                  transform: "scale(1.05)",
                },
              }}
            >
              <Icon color="orange.fg" boxSize={6}>
                <opt.icon strokeWidth={1.5} />
              </Icon>
            </Box>

            <VStack gap={0.5} align="start" flex={1}>
              <Text fontSize="md" fontWeight="semibold" color="fg" letterSpacing="-0.01em">
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
