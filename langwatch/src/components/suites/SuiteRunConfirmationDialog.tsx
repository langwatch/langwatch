/**
 * Confirmation dialog shown before running a suite.
 *
 * Displays the suite name, scenario count, target count, repeat count,
 * and estimated total job count so users know what will be scheduled.
 */

import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { FileText, Layers, Repeat2, Target } from "lucide-react";
import { Dialog } from "../ui/dialog";

export type SuiteRunSummary = {
  suiteName: string;
  scenarioCount: number;
  targetCount: number;
  repeatCount: number;
};

function calculateJobCount({
  scenarioCount,
  targetCount,
  repeatCount,
}: {
  scenarioCount: number;
  targetCount: number;
  repeatCount: number;
}): number {
  return scenarioCount * targetCount * repeatCount;
}

export function SuiteRunConfirmationDialog({
  open,
  onClose,
  onConfirm,
  summary,
  isLoading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  summary: SuiteRunSummary | null;
  isLoading?: boolean;
}) {
  const jobCount = summary
    ? calculateJobCount({
        scenarioCount: summary.scenarioCount,
        targetCount: summary.targetCount,
        repeatCount: summary.repeatCount,
      })
    : 0;

  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Content maxWidth="480px" onClick={(e) => e.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Run suite?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            {summary && (
              <>
                <Text fontWeight="semibold">{summary.suiteName}</Text>
                <VStack
                  align="stretch"
                  gap={2}
                  bg="bg.subtle"
                  padding={3}
                  borderRadius="md"
                >
                  <HStack gap={2}>
                    <FileText size={14} />
                    <Text fontSize="sm">
                      {summary.scenarioCount} scenario
                      {summary.scenarioCount !== 1 ? "s" : ""}
                    </Text>
                  </HStack>
                  <HStack gap={2}>
                    <Target size={14} />
                    <Text fontSize="sm">
                      {summary.targetCount} target
                      {summary.targetCount !== 1 ? "s" : ""}
                    </Text>
                  </HStack>
                  {summary.repeatCount > 1 && (
                    <HStack gap={2}>
                      <Repeat2 size={14} />
                      <Text fontSize="sm">
                        {summary.repeatCount}x repeat
                      </Text>
                    </HStack>
                  )}
                </VStack>
                <HStack gap={2} justify="center">
                  <Layers size={16} />
                  <Text fontSize="sm" fontWeight="semibold">
                    {jobCount} job{jobCount !== 1 ? "s" : ""} will be scheduled
                  </Text>
                </HStack>
              </>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
            mr={3}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            disabled={isLoading}
          >
            {isLoading ? <Spinner size="sm" /> : "Run"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
