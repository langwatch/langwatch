import { Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** One titled block of a settings page. */
export function SettingsBlock({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <VStack
      width="full"
      align="stretch"
      gap={4}
      paddingY={6}
      borderBottomWidth="1px"
      borderColor="border.muted"
      data-testid={testId}
    >
      <VStack align="start" gap={1}>
        <Heading size="md">{title}</Heading>
        {description ? (
          <Text fontSize="sm" color="fg.muted">
            {description}
          </Text>
        ) : null}
      </VStack>
      {children}
    </VStack>
  );
}

/** One labelled figure. */
export function Figure({ label, value }: { label: string; value: string }) {
  return (
    <VStack align="start" gap={0.5}>
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight={600}>
        {value}
      </Text>
    </VStack>
  );
}
