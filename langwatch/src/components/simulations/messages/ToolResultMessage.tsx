import { Box, Text, VStack } from "@chakra-ui/react";
import type { ResultMessage } from "@copilotkit/runtime-client-gql";
import { RenderInputOutput } from "../../traces/RenderInputOutput";

export const ToolResultMessage = ({ message }: { message: ResultMessage }) => {
  return (
    <VStack w="full" gap={2} mb={2} align="start">
      <Box
        w="full"
        maxW="80%"
        bg="bg.subtle"
        border="1px solid"
        borderColor="border"
        borderRadius="lg"
        p={3}
      >
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2}>
          Tool result
        </Text>
        <Box
          bg="bg.panel"
          border="1px solid"
          borderColor="border"
          borderRadius="md"
          p={2}
        >
          <RenderInputOutput value={message.result} />
        </Box>
      </Box>
    </VStack>
  );
};
