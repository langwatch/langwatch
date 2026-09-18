import { Text } from "@chakra-ui/react";

/**
 * The DEV pill in the top bar of a development build, shared by the
 * legacy chrome and navigation-v2 shells: both draw the same top bar
 * while the two modes ship together, so a style change must reach both.
 */
export function DevBadge() {
  return (
    <Text
      fontSize="11px"
      fontWeight="bold"
      color="white"
      backgroundColor="blackAlpha.600"
      border="1px solid"
      borderColor="whiteAlpha.300"
      borderRadius="full"
      height="32px"
      paddingX={3}
      display="flex"
      alignItems="center"
      letterSpacing="wider"
    >
      DEV
    </Text>
  );
}
