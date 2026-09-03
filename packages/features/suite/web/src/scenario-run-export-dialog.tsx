import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";

export type ScenarioRunExportMode = "full" | "criteria";

/**
 * Each mode states what one row is. That is the only thing distinguishing
 * them, and it decides which questions the resulting file can answer.
 */
const MODES: { value: ScenarioRunExportMode; label: string; hint: string }[] = [
  {
    value: "full",
    label: "Full",
    hint: "One row per message — the complete export",
  },
  {
    value: "criteria",
    label: "Criteria",
    hint: "One row per checklist item — rank what fails most",
  },
];

export function ScenarioRunExportDialog({
  isOpen,
  onClose,
  onExport,
  runCount,
  hasFiltersApplied,
}: {
  isOpen: boolean;
  onClose: () => void;
  onExport: (config: { mode: ScenarioRunExportMode }) => void;
  runCount: number;
  hasFiltersApplied: boolean;
}) {
  const [mode, setMode] = useState<ScenarioRunExportMode>("full");

  return (
    <Dialog.Root open={isOpen} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Export Scenario Runs</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={5}>
            <Text color="fg.muted" fontSize="sm">
              {runCount.toLocaleString()} {runCount === 1 ? "run" : "runs"}
              {hasFiltersApplied ? " matching your filters" : ""}
            </Text>

            <VStack align="stretch" gap={2}>
              <Text fontWeight="medium" fontSize="sm">
                Mode
              </Text>
              <RadioGroup
                value={mode}
                onValueChange={({ value }) => {
                  if (value === "full" || value === "criteria") {
                    setMode(value);
                  }
                }}
              >
                <VStack align="stretch" gap={2}>
                  {MODES.map((option) => (
                    <HStack key={option.value} gap={2}>
                      <Radio value={option.value}>{option.label}</Radio>
                      <Text color="fg.muted" fontSize="xs">
                        {option.hint}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              </RadioGroup>
            </VStack>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="blue" onClick={() => onExport({ mode })}>
              <Download size={16} />
              Export
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
