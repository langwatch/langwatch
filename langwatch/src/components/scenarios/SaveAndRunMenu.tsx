import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, Play, Save } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../ui/popover";
import { TargetSelector, type TargetValue } from "./TargetSelector";

interface SaveAndRunMenuProps {
  selectedTarget: TargetValue;
  onTargetChange: (target: TargetValue) => void;
  onSaveAndRun: () => void;
  onSaveWithoutRunning: () => void;
  onCreateAgent: () => void;
  isLoading?: boolean;
}

/**
 * Combined "Save and Run" dropdown menu with target selection.
 * Contains target selector, run button, and save-only option.
 */
export function SaveAndRunMenu({
  selectedTarget,
  onTargetChange,
  onSaveAndRun,
  onSaveWithoutRunning,
  onCreateAgent,
  isLoading = false,
}: SaveAndRunMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleSaveAndRun = () => {
    setOpen(false);
    onSaveAndRun();
  };

  const handleSaveWithoutRunning = () => {
    setOpen(false);
    onSaveWithoutRunning();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "top-end" }}
    >
      <Popover.Trigger asChild>
        <Button
          ref={triggerRef}
          colorPalette="blue"
          size="sm"
          loading={isLoading}
        >
          <Play size={14} />
          Save and Run
          <ChevronDown size={14} />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Content width="320px" padding={0}>
          <VStack gap={0} align="stretch">
            {/* Target Selection Section */}
            <Box padding={4} borderBottomWidth="1px" borderColor="gray.200">
              <VStack gap={3} align="stretch">
                <Text fontSize="sm" fontWeight="medium">
                  Select target to run against
                </Text>
                <TargetSelector
                  value={selectedTarget}
                  onChange={onTargetChange}
                  onCreateAgent={onCreateAgent}
                />
              </VStack>
            </Box>

            {/* Actions */}
            <VStack gap={0} align="stretch">
              <Button
                variant="ghost"
                size="sm"
                justifyContent="flex-start"
                padding={4}
                borderRadius={0}
                onClick={handleSaveAndRun}
                disabled={!selectedTarget}
                colorPalette={selectedTarget ? "blue" : undefined}
              >
                <HStack gap={2}>
                  <Play size={14} />
                  <Text>Run Scenario</Text>
                </HStack>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                justifyContent="flex-start"
                padding={4}
                borderRadius={0}
                borderTopWidth="1px"
                borderColor="gray.100"
                onClick={handleSaveWithoutRunning}
              >
                <HStack gap={2}>
                  <Save size={14} />
                  <Text>Save without running</Text>
                </HStack>
              </Button>
            </VStack>
          </VStack>
        </Popover.Content>
      </Portal>
    </Popover.Root>
  );
}
