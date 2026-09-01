/**
 * What the run drawer reads when the run behind the address cannot be read.
 *
 * A run that is simply not written down yet is not this: that run is queued,
 * and it draws the whole drawer with a queued line where the messages will be.
 *
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { HandledErrorAlert } from "~/features/errors";

export function RunDrawerErrorBody({ error }: { error: unknown }) {
  return (
    <Drawer.Body bg={{ base: "bg.surface", _dark: "bg.panel" }}>
      <VStack gap={3} align="start" w="100%" pt={4}>
        <Drawer.CloseTrigger />
        <Box width="100%">
          <HandledErrorAlert error={error} fallbackTitle="Failed to load run" />
        </Box>
      </VStack>
    </Drawer.Body>
  );
}
