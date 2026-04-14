import { HStack, Text } from "@chakra-ui/react";

export function SearchHeader() {
  return (
    <HStack
      height="48px"
      flexShrink={0}
      paddingX={6}
      width="full"
      borderBottom="1px solid"
      borderBottomColor="border"
      gap={2}
      position="sticky"
      top={0}
      zIndex={10}
      background="bg.surface"
    >
      <Text textStyle="md" fontWeight="semibold">
        Deja View
      </Text>
    </HStack>
  );
}
