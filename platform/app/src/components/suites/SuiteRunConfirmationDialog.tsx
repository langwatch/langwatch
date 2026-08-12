/**
 * Confirmation dialog shown before running a suite.
 *
 * Displays the suite name, scenario/target counts, and estimated job count
 * so the user can review what will be executed before confirming.
 */

import { Button, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { Crosshair, FileText, Repeat } from "lucide-react";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
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

/**
 * One input per parameter the run can carry, prefilled with the value the run
 * would use if nothing here is touched.
 */
function RunParameterFields({
  parameters,
  values,
  onChange,
  disabled,
}: {
  parameters: ScenarioParameterDefinition[];
  values: Record<string, string>;
  onChange?: (name: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      data-testid="suite-run-parameters"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text
        fontSize="11px"
        fontWeight="bold"
        textTransform="uppercase"
        color="fg.muted"
        letterSpacing="0.5px"
      >
        Parameters
      </Text>
      {parameters.map((parameter) => (
        <HStack key={parameter.name} gap={2}>
          <HStack gap={0} width="180px" flexShrink={0} minWidth={0}>
            <Text fontSize="sm" fontFamily="mono" truncate>
              {parameter.name}
            </Text>
            {parameter.description && (
              <FieldInfoTooltip
                description={parameter.description}
                testId={`suite-run-parameter-info-${parameter.name}`}
              />
            )}
          </HStack>
          <Input
            size="sm"
            flex={1}
            fontFamily="mono"
            fontSize="13px"
            aria-label={parameter.name}
            value={values[parameter.name] ?? ""}
            onChange={(e) => onChange?.(parameter.name, e.target.value)}
            disabled={disabled}
            data-testid={`suite-run-parameter-${parameter.name}`}
          />
        </HStack>
      ))}
    </VStack>
  );
}
