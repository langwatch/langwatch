import { Dialog } from "@langwatch/design-system/dialog";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { Download } from "lucide-react";
import { useState } from "react";

export type ScenarioRunExportMode = "full" | "criteria";

/**
 * Each mode states what one row is. That is the only thing distinguishing
 * them, and it decides which questions the resulting file can answer.
 */
const MODES: { value: ScenarioRunExportMode; label: string; hint: string }[] = [
  {
    value: "full",
    label: "Full",
    hint: "One row per message: the complete export",
  },
  {
    value: "criteria",
    label: "Criteria",
    hint: "One row per checklist item: rank what fails most",
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
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Export scenario runs"
      primaryAction={{
        label: "Export",
        icon: <Download size={14} />,
        onClick: () => onExport({ mode }),
      }}
    >
      <VStack align="stretch" gap={5}>
        <Text color="fg.muted" fontSize="sm">
          <FormattedNumber value={runCount} /> {runCount === 1 ? "run" : "runs"}
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
    </Dialog>
  );
}
