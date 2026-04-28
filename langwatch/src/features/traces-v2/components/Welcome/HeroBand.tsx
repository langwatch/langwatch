import { Badge, Box, HStack, Heading, Icon, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";

interface HeroBandProps {
  title: string;
  subtitle: string;
}

export const HeroBand: React.FC<HeroBandProps> = ({ title, subtitle }) => (
  <Box
    position="relative"
    paddingX={6}
    paddingY={6}
    borderRadius="xl"
    overflow="hidden"
    backgroundImage="linear-gradient(135deg, var(--chakra-colors-purple-subtle) 0%, var(--chakra-colors-blue-subtle) 60%, var(--chakra-colors-cyan-subtle) 100%)"
  >
    <Box
      position="absolute"
      top="-60px"
      right="-60px"
      width="240px"
      height="240px"
      borderRadius="full"
      bg="purple.solid"
      opacity={0.18}
      filter="blur(60px)"
      pointerEvents="none"
    />
    <Box
      position="absolute"
      bottom="-80px"
      left="-40px"
      width="220px"
      height="220px"
      borderRadius="full"
      bg="blue.solid"
      opacity={0.15}
      filter="blur(60px)"
      pointerEvents="none"
    />
    <VStack align="stretch" gap={2} position="relative">
      <HStack gap={2}>
        <Badge colorPalette="purple" variant="solid" size="sm" borderRadius="full">
          <Icon boxSize={3}>
            <Sparkles />
          </Icon>
          Alpha
        </Badge>
        <Text textStyle="xs" color="fg.muted" fontWeight="medium">
          Traces · v2
        </Text>
      </HStack>
      <Heading size="2xl" letterSpacing="-0.02em">
        {title}
      </Heading>
      <Text color="fg.muted" textStyle="md" maxWidth="600px">
        {subtitle}
      </Text>
    </VStack>
  </Box>
);
