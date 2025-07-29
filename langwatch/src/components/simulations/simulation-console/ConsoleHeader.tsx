import { Text } from "@chakra-ui/react";

/**
 * Console header component
 * Single Responsibility: Displays the console header text
 */
export function ConsoleHeader() {
  return (
    <Text color="white" fontWeight="bold" mb={2}>
      === Scenario Test Report ===
    </Text>
  );
}
