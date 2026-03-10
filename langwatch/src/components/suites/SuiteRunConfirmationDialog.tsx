/**
 * Confirmation dialog shown before running a suite.
 *
 * Displays the suite name, scenario/target counts, and estimated job count
 * so the user can review what will be executed before confirming.
 */

import { Button, Spinner, Text, VStack } from "@chakra-ui/react";
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
            This will start {estimatedJobs} new{" "}
            {estimatedJobs === 1 ? "run" : "runs"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Text fontWeight="semibold">{suiteName}</Text>
            <Text color="fg.muted" fontSize="sm">
              {scenarioCount} {scenarioCount === 1 ? "scenario" : "scenarios"}{" "}
              &times; {targetCount}{" "}
              {targetCount === 1 ? "target" : "targets"}
              {repeatCount > 1 && <> &times; {repeatCount} repeats</>}
            </Text>
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
