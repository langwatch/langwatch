import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { useState } from "react";
import type { ScenarioRunExportMode } from "~/server/export/scenario-runs/types";
import { Dialog } from "../ui/dialog";
import { Radio, RadioGroup } from "../ui/radio";

/**
 * Each mode states what one row is, because that is the only thing that
 * distinguishes them and it decides which questions the file can answer.
 */
const MODES: { value: ScenarioRunExportMode; label: string; hint: string }[] = [
  {
    value: "summary",
    label: "Summary",
    hint: "One row per run — pass rates, cost, duration",
  },
  {
    value: "criteria",
    label: "Criteria",
    hint: "One row per criterion — rank what fails most",
  },
  {
    value: "full",
    label: "Full",
    hint: "One row per message — read the transcripts",
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
  const [mode, setMode] = useState<ScenarioRunExportMode>("summary");

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
                onValueChange={({ value }) =>
                  setMode(value as ScenarioRunExportMode)
                }
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
