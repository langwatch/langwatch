import { Box, Button, Flex, Text, HStack, VStack, Drawer, Portal, CloseButton } from "@chakra-ui/react";
import { Play, RotateCcw, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/router";
import { PlaygroundContent } from "./PlaygroundContent";
import { PresetPicker } from "./PresetPicker";
import { useTraceStore } from "./traceStore";
import { useExecutionStore } from "./executionStore";
import { api } from "~/utils/api";

/**
 * Mini playground that opens in a drawer.
 * Usage: <PlaygroundDrawer isOpen={isOpen} onClose={onClose} />
 *
 * Can be triggered from command bar or a button.
 */
export function PlaygroundDrawer({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const resetTrace = useTraceStore((s) => s.resetTrace);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="xl"
      placement="end"
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content>
            <Drawer.Header borderBottom="1px solid" borderColor="gray.700" py={2}>
              <Flex align="center" justify="space-between" w="full">
                <HStack gap={2}>
                  <Drawer.Title fontSize="sm" fontWeight="semibold">
                    OTel Playground
                  </Drawer.Title>
                  <PresetPicker />
                </HStack>
                <HStack gap={1}>
                  <Button size="xs" variant="ghost" onClick={resetTrace}>
                    <RotateCcw size={12} />
                  </Button>
                  <Drawer.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Drawer.CloseTrigger>
                </HStack>
              </Flex>
            </Drawer.Header>
            <Drawer.Body p={0} overflow="hidden">
              <Box h="full">
                <PlaygroundContent compact />
              </Box>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}

/**
 * Quick send button that can be placed anywhere.
 * Opens the playground drawer when clicked.
 */
export function PlaygroundQuickButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsOpen(true)}
      >
        <Play size={14} />
        Send Test Trace
      </Button>
      <PlaygroundDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
