import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { useState } from "react";
import type { ExportMode, ExportFormat } from "~/server/export/types";
import { Dialog } from "../ui/dialog";
import { Radio, RadioGroup } from "../ui/radio";

interface ExportConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (config: { mode: ExportMode; format: ExportFormat }) => void;
  traceCount: number;
  /** True when exporting selected traces instead of all matching traces */
  isSelectedExport: boolean;
}

const EXPORT_LIMIT = 10_000;

function formatTraceCount({
  traceCount,
  isSelectedExport,
}: {
  traceCount: number;
  isSelectedExport: boolean;
}): string {
  const formattedCount = traceCount.toLocaleString();

  if (isSelectedExport) {
    return `${formattedCount} selected traces`;
  }

  if (traceCount >= EXPORT_LIMIT) {
    return `${formattedCount} traces (limit)`;
  }

  return `${formattedCount} traces`;
}

export function ExportConfigDialog({
  isOpen,
  onClose,
  onExport,
  traceCount,
  isSelectedExport,
}: ExportConfigDialogProps) {
  const [mode, setMode] = useState<ExportMode>("summary");
  const [format, setFormat] = useState<ExportFormat>("csv");

  const handleExport = () => {
    onExport({ mode, format });
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Export Traces</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={5}>
            <Text color="fg.muted" fontSize="sm">
              {formatTraceCount({ traceCount, isSelectedExport })}
            </Text>

            <VStack align="stretch" gap={2}>
              <Text fontWeight="medium" fontSize="sm">
                Mode
              </Text>
              <RadioGroup
                value={mode}
                onValueChange={({ value }) => setMode(value as ExportMode)}
              >
                <VStack align="stretch" gap={2}>
                  <HStack gap={2}>
                    <Radio value="summary">Summary</Radio>
                    <Text color="fg.muted" fontSize="xs">
                      One row per trace
                    </Text>
                  </HStack>
                  <HStack gap={2}>
                    <Radio value="full">Full</Radio>
                    <Text color="fg.muted" fontSize="xs">
                      One row per span, includes inputs/outputs
                    </Text>
                  </HStack>
                </VStack>
              </RadioGroup>
            </VStack>

            <VStack align="stretch" gap={2}>
              <Text fontWeight="medium" fontSize="sm">
                Format
              </Text>
              <RadioGroup
                value={format}
                onValueChange={({ value }) => setFormat(value as ExportFormat)}
              >
                <HStack gap={4}>
                  <Radio value="csv">CSV</Radio>
                  <Radio value="json">JSON</Radio>
                </HStack>
              </RadioGroup>
            </VStack>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="blue" onClick={handleExport}>
              <Download size={16} />
              Export
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
