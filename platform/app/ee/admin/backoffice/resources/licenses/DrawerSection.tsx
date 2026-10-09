import { Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** A labelled value in the license details grid. */
export function Detail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      {/* A value can be a Text of its own, and a p may not hold a p. */}
      <Text as="div">{children}</Text>
    </VStack>
  );
}

/** A titled block of the license drawer, separated by a rule. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack
      align="start"
      gap={3}
      width="full"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text fontWeight="semibold">{title}</Text>
      {children}
    </VStack>
  );
}
