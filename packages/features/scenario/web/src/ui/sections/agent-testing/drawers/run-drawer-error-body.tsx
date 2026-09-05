/**
 * What the run drawer reads when the run behind the address cannot be read.
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { HandledErrorAlert } from "../../../../behavior/errors";

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
