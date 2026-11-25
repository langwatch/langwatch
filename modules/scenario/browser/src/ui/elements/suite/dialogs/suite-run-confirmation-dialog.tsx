/**
 * Confirmation dialog shown before running a suite: suite name, scenario/
 * target counts, and estimated job count, so the user reviews before confirming.
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Popover } from "@langwatch/design-system/popover";
import { Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import { Crosshair, FileText, Info, Lock, Repeat } from "lucide-react";
import { type Ref, useRef } from "react";

function ParameterInfoTooltip({ description, testId }: { description: string; testId: string }) {
  return (
    <Popover.Root positioning={{ placement: "right-start" }}>
      <Popover.Trigger asChild>
        <Button
          aria-label="More info"
          data-testid={testId}
          size="xs"
          variant="ghost"
          color="fg.muted"
          marginLeft={1}
          minWidth="auto"
          height="auto"
          padding={0}
        >
          <Info size={14} />
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="sm">
        <Popover.Body>
          <Text fontSize="sm">{description}</Text>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/** What a secret parameter with no value yet says under its field. */
const MISSING_SECRET_MESSAGE = "Type the value to start the run.";

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
    (parameter) => parameter.secret === true && (parameterValues[parameter.name] ?? "") === "",
  );

  const parametersRef = useRef<HTMLDivElement>(null);

  // A run with a secret still empty stays on this dialog: focus the first one.
  const handleConfirm = () => {
    if (missingSecrets) {
      parametersRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
      return;
    }
    onConfirm();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={suiteName}
      size="md"
      placement="center"
      busy={isLoading}
      primaryAction={{
        label: `Run ${estimatedJobs} ${estimatedJobs === 1 ? "job" : "jobs"}`,
        loading: isLoading,
        onClick: handleConfirm,
      }}
    >
      <VStack align="stretch" gap={4}>
        <Text fontWeight="semibold">
          {" "}
          Run {estimatedJobs} {estimatedJobs === 1 ? "simulation" : "simulations"}?
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
            ref={parametersRef}
            parameters={parameters}
            values={parameterValues}
            onChange={onParameterChange}
            disabled={isLoading}
          />
        )}
      </VStack>
    </Dialog>
  );
}

/**
 * One input per parameter the run can carry, prefilled with the value it
 * would use untouched. A secret parameter is the exception: no default,
 * its field hides what is typed, and the run waits for it.
 */
function RunParameterFields({
  ref,
  parameters,
  values,
  onChange,
  disabled,
}: {
  ref: Ref<HTMLDivElement>;
  parameters: ScenarioParameterDefinition[];
  values: Record<string, string>;
  onChange?: (name: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <VStack
      ref={ref}
      align="stretch"
      gap={2}
      data-testid="suite-run-parameters"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text
        textStyle="micro"
        fontWeight="bold"
        textTransform="uppercase"
        color="fg.muted"
        letterSpacing="0.5px"
      >
        Parameters
      </Text>
      {parameters.map((parameter) => (
        <RunParameterField
          key={parameter.name}
          parameter={parameter}
          value={values[parameter.name] ?? ""}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
    </VStack>
  );
}

/** One name, its description, and the field that holds its value. */
function RunParameterField({
  parameter,
  value,
  onChange,
  disabled,
}: {
  parameter: ScenarioParameterDefinition;
  value: string;
  onChange?: (name: string, value: string) => void;
  disabled: boolean;
}) {
  const isSecret = parameter.secret === true;
  const isMissing = isSecret && value === "";

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <HStack gap={0} width="180px" flexShrink={0} minWidth={0}>
          {isSecret && <Lock size={12} color="var(--chakra-colors-fg-muted)" />}
          <Text fontSize="sm" fontFamily="mono" truncate paddingLeft={isSecret ? 1 : 0}>
            {parameter.name}
          </Text>
          {parameter.description && (
            <ParameterInfoTooltip
              description={parameter.description}
              testId={`suite-run-param-info-${parameter.name}`}
            />
          )}
        </HStack>
        <Input
          size="sm"
          flex={1}
          fontFamily="mono"
          textStyle="bodySm"
          type={isSecret ? "password" : "text"}
          autoComplete={isSecret ? "new-password" : undefined}
          required={isSecret}
          aria-label={parameter.name}
          aria-invalid={isMissing || undefined}
          value={value}
          onChange={(e) => onChange?.(parameter.name, e.target.value)}
          disabled={disabled}
          data-testid={`suite-run-parameter-${parameter.name}`}
        />
      </HStack>
      {isMissing && (
        <Text
          fontSize="xs"
          color="fg.error"
          paddingLeft="188px"
          data-testid={`suite-run-parameter-error-${parameter.name}`}
        >
          {MISSING_SECRET_MESSAGE}
        </Text>
      )}
    </VStack>
  );
}
