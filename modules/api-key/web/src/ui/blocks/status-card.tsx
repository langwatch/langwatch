// CLI authorize flow state message. Traces-v2 visual language. Role derived (alert vs status)
// matters for screen readers (refusals interrupt; success/explanation are polite).

import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import type React from "react";

export function StatusCard({
  palette,
  icon,
  title,
  children,
}: {
  palette: "green" | "red" | "orange" | "blue";
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  const role = palette === "red" || palette === "orange" ? "alert" : "status";
  return (
    <Box
      role={role}
      borderWidth="1px"
      borderColor={`${palette}.muted`}
      borderRadius="lg"
      bg={`${palette}.subtle`}
      paddingX={5}
      paddingY={4}
    >
      <HStack align="flex-start" gap={3}>
        <Icon as={icon} boxSize={5} color={`${palette}.fg`} flexShrink={0} marginTop={0.5} />
        <VStack align="stretch" gap={1} flex={1}>
          <Text textStyle="sm" fontWeight="semibold" color="fg" lineHeight="snug">
            {title}
          </Text>
          <Text textStyle="xs" color="fg.muted" lineHeight="tall">
            {children}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
