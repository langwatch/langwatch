/**
 * Confirmation dialog shown before running a suite.
 *
 * Displays the suite name, scenario/target counts, and estimated job count
 * so the user can review what will be executed before confirming.
 */

import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Crosshair, FileText, Repeat } from "lucide-react";
import { Dialog } from "../ui/dialog";

export function SuiteRunConfirmationDialog({
  open,
  onClose,
  onConfirm,
  suiteName,
  scenarioCount,
  targetCount,
  repeatCount = 1,
  isLoading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  suiteName: string;
  scenarioCount: number;
  targetCount: number;
  repeatCount?: number;
  isLoading?: boolean;
}) {
  const estimatedJobs = scenarioCount * targetCount * repeatCount;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={() => {
        if (!isLoading) onClose();
      }}
      placement="center"
    >
      <Dialog.Content maxWidth="500px" onClick={(e) => e.stopPropagation()}>
        {!isLoading && <Dialog.CloseTrigger />}
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Start {estimatedJobs} new{" "}
            {estimatedJobs === 1 ? "run" : "runs"}?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            <Text fontWeight="semibold">{suiteName}</Text>
            <HStack gap={6}>
              <VStack gap={0} align="start">
                <HStack gap={1.5} align="center">
                  <FileText size={14} color="var(--chakra-colors-fg-muted)" />
                  <Text fontSize="lg" fontWeight="semibold">
                    {scenarioCount}
                  </Text>
                </HStack>
                <Text color="fg.muted" fontSize="sm">
                  {scenarioCount === 1 ? "scenario" : "scenarios"}
                </Text>
              </VStack>
              <VStack gap={0} align="start">
                <HStack gap={1.5} align="center">
                  <Crosshair size={14} color="var(--chakra-colors-fg-muted)" />
                  <Text fontSize="lg" fontWeight="semibold">
                    {targetCount}
                  </Text>
                </HStack>
                <Text color="fg.muted" fontSize="sm">
                  {targetCount === 1 ? "target" : "targets"}
                </Text>
              </VStack>
              {repeatCount > 1 && (
                <VStack gap={0} align="start">
                  <HStack gap={1.5} align="center">
                    <Repeat size={14} color="var(--chakra-colors-fg-muted)" />
                    <Text fontSize="lg" fontWeight="semibold">
                      {repeatCount}x
                    </Text>
                  </HStack>
                  <Text color="fg.muted" fontSize="sm">
                    repeats
                  </Text>
                </VStack>
              )}
            </HStack>
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
            {isLoading ? (
              <Spinner size="sm" />
            ) : (
              `Run ${estimatedJobs} ${estimatedJobs === 1 ? "Job" : "Jobs"}`
            )}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
