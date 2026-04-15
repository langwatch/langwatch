import { Box, HStack, Text } from "@chakra-ui/react";
import { JsonViewer } from "~/components/ops/JsonViewer";
import type { EventResult } from "./types";

export function RightPanel({ event }: { event: EventResult }) {
  return (
    <Box
      width="400px"
      minWidth="400px"
      borderLeft="1px solid"
      borderLeftColor="border"
      overflow="hidden"
      display="flex"
      flexDirection="column"
    >
      <HStack
        paddingX={4}
        paddingY={2}
        borderBottom="1px solid"
        borderBottomColor="border"
        flexShrink={0}
        bg="bg.subtle"
      >
        <Text textStyle="xs" fontWeight="medium">
          Event Payload
        </Text>
        <Box flex={1} />
        <Text textStyle="xs" color="fg.muted">
          Press &apos;e&apos; to close
        </Text>
      </HStack>
      <Box flex={1} padding={4} overflow="auto">
        <JsonViewer data={event.payload} />
      </Box>
    </Box>
  );
}
