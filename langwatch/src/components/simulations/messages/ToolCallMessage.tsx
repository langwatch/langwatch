import { VStack, Box, Text, HStack } from "@chakra-ui/react";
import type { ActionExecutionMessage } from "@copilotkit/runtime-client-gql";
import { RenderInputOutput } from "../../traces/RenderInputOutput";
import { Settings } from "react-feather";

export const ToolCallMessage = ({
  message,
}: {
  message: ActionExecutionMessage;
}) => {
  return (
    <VStack w="full" gap={2} mb={2} align="start">
      <HStack gap={2}>
        <Settings size={12} color="#ea580c" />
        <Text fontSize="xs" color="orange.600" fontWeight="medium">
          {message.name}
        </Text>
      </HStack>
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
          Tool arguments
        </Text>
        <Box
          bg="white"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="md"
          p={2}
        >
          <RenderInputOutput value={message.arguments} />
        </Box>
      </Box>
    </VStack>
  );
};
