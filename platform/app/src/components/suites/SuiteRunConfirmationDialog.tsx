/**
 * Confirmation dialog shown before running a suite.
 *
 * Displays the suite name, scenario/target counts, and estimated job count
 * so the user can review what will be executed before confirming.
 *
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Crosshair, FileText, Repeat } from "lucide-react";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import { Dialog } from "../ui/dialog";
import { RunParameterFields } from "./RunParameterFields";

export function SuiteRunConfirmationDialog({
  open,
  onClose,
  onConfirm,
  suiteName,
  scenarioCount,
  targetCount,
  repeatCount = 1,
  isLoading = false,
  parameters = [],
  parameterValues = {},
  onParameterChange,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  suiteName: string;
  scenarioCount: number;
  targetCount: number;
  repeatCount?: number;
  isLoading?: boolean;
  /** Every parameter the scenarios in this run declare, between them. */
  parameters?: ScenarioParameterDefinition[];
  /** The value offered for each name, keyed by name. */
  parameterValues?: Record<string, string>;
  onParameterChange?: (name: string, value: string) => void;
}) {
  const estimatedJobs = scenarioCount * targetCount * repeatCount;

  // A secret has no default and the run refuses to start without it, so the
  // dialog holds the run here rather than sending it to be rejected.
  const missingSecrets = parameters.some(
    (parameter) =>
      parameter.secret === true &&
      (parameterValues[parameter.name] ?? "") === "",
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={() => {
        if (!isLoading) onClose();
      }}
      placement="center"
    >
      <Dialog.Content
        bg="bg"
        maxWidth="500px"
        onClick={(e) => e.stopPropagation()}
      >
        {!isLoading && <Dialog.CloseTrigger />}
        <Dialog.Header>
          <Dialog.Title>{suiteName}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            <Text fontWeight="semibold">
              {" "}
              Run {estimatedJobs}{" "}
              {estimatedJobs === 1 ? "simulation" : "simulations"}?
            </Text>
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

            {parameters.length > 0 && (
              <RunParameterFields
                parameters={parameters}
                values={parameterValues}
                onChange={onParameterChange}
                disabled={isLoading}
              />
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
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
            disabled={isLoading || missingSecrets}
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
