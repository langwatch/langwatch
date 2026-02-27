import { Box, Text } from "@chakra-ui/react";
import { FailedJobsList } from "../components/errors/FailedJobsList.tsx";

export function ErrorInspectorPage() {
  return (
    <Box p={6}>
      <Text
        fontSize="xl"
        fontWeight="bold"
        mb={2}
        color="#ff0033"
        textTransform="uppercase"
        letterSpacing="0.2em"
        textShadow="0 0 15px rgba(255, 0, 51, 0.3)"
      >
        // THREAT ANALYSIS
      </Text>
      <Text fontSize="sm" color="#ffaa00" mb={6} textTransform="uppercase" letterSpacing="0.1em">
        Failed BullMQ jobs across all queues. Expand rows to see stack traces.
      </Text>
      <FailedJobsList />
    </Box>
  );
}
