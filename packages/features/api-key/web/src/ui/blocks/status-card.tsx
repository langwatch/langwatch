/**
 * One state of the CLI authorize flow, said in a sentence.
 *
 * Moved from `platform/app/src/pages/cli/auth.tsx`, where it was a local
 * component. In the traces-v2 visual language — semantic palette tokens and a
 * lucide icon in a subtle tinted container (see
 * `features/traces-v2/docs/STANDARDS.md` §4) — which is what replaced the stock
 * Chakra `Alert` on this page.
 *
 * The ROLE is derived rather than passed, and it matters: a refusal interrupts
 * a screen reader (`role="alert"`), while a success or an explanation announces
 * politely (`role="status"`). Getting that backwards is invisible until somebody
 * is reading the page with their ears.
 */

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
