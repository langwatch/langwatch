import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ActionExecutionMessage } from "@copilotkit/runtime-client-gql";
import { Settings } from "react-feather";
import { RenderInputOutput } from "../../traces/RenderInputOutput";

export const ToolCallMessage = ({
  message,
}: {
  message: ActionExecutionMessage;
}) => {
  return (
    <VStack w="full" gap={2} mb={2} align="start">
      <HStack gap={2}>
        <Box color="orange.fg">
          <Settings size={12} />
        </Box>
        <Text fontSize="xs" color="orange.fg" fontWeight="medium">
          {message.name}
        </Text>
      </HStack>
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
          Tool arguments
        </Text>
        <Box
          bg="bg.panel"
          border="1px solid"
          borderColor="border"
          borderRadius="md"
          p={2}
        >
          <RenderInputOutput
            value={message.arguments ?? (message as any).input}
          />
        </Box>
      </Box>
    </VStack>
  );
};
