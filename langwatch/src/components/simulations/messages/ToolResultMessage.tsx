import { VStack, Box, Text } from "@chakra-ui/react";
import type { ResultMessage } from "@copilotkit/runtime-client-gql";
import { RenderInputOutput } from "../../traces/RenderInputOutput";

export const ToolResultMessage = ({ message }: { message: ResultMessage }) => {
  return (
    <VStack w="full" gap={2} mb={2} align="start">
      <Box
        w="full"
        maxW="80%"
        bg="gray.50"
        border="1px solid"
        borderColor="gray.200"
        borderRadius="lg"
        p={3}
      >
        <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={2}>
          Tool result
        </Text>
        <Box
          bg="white"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="md"
          p={2}
        >
          <RenderInputOutput value={message.result} />
        </Box>
      </Box>
    </VStack>
  );
};
