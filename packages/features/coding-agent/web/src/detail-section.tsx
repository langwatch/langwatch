import { Heading, Text, VStack } from "@chakra-ui/react";
import type React from "react";

/** One titled block of the pull request detail. */
export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <VStack align="stretch" gap={2}>
    <Heading size="sm">{title}</Heading>
    {children}
  </VStack>
);

/** What a section says instead of showing an empty table. */
export const EmptySection: React.FC<{ children: string }> = ({ children }) => (
  <Text fontSize="sm" color="fg.muted">
    {children}
  </Text>
);
