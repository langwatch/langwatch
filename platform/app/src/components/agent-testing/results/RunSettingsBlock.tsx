/**
 * What the selected run was configured with, under the header line.
 *
 * A run says how it scored. This block says what it was, so a person reading
 * run 2 against run 3 can see which setting moved the number.
 *
 * It reads only what the run itself recorded. When the run started reads here
 * rather than on the header line, with its date, because the header line and
 * the runs rail beside it would otherwise say the same thing three times. Who
 * started it reads on that same row, because when and who are one fact about
 * the start of the run. A run that recorded no person reads the time alone.
 *
 * A parameter reads in a
 * monospace font, because a value like `eu-central` is a literal and a
 * proportional font hides the difference between two of them. The judge reads
 * on every run, even a standard one, because the judge is what decided every
 * verdict on the page. Each model row names the model the run really ran on,
 * which the run recorded when it was queued. The repeat count and the
 * simulator model read only when the run carries them, so a run that recorded
 * neither stays a short block.
 *
 * The targets row names every target the run went against, on a run against
 * one target as much as on a comparison. A comparison has one layer of
 * parameters: each target line carries every value that target received, and
 * there is no parameters row. A run against one target reads the target's
 * own overrides on its line and the run-level values on the parameters row,
 * so no value reads twice.
 *
 * The run note is not here. It reads in the header line and does not move.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import { FG_MUTED } from "../shared/design";
import { TargetMark } from "../shared/TargetMark";
import type { RunSettingParameter, RunSettings } from "./run-settings";
import type { BatchTarget } from "./useBatchTargets";

/**
 * What a model row says when the run recorded no model at all.
 *
 * Only a run stored before the resolved models were recorded reads this way.
 * Such a run did not go unjudged: it took the default model of the project of
 * that day. The row cannot print that model, because the default of today is
 * not always the one the run took.
 */
export const PROJECT_DEFAULT_MODEL = "Project default model";

const LABEL_WIDTH = "104px";

/**
 * The line every row of the block stands on.
 *
 * The rows are centred rather than aligned on a baseline. A row whose value is
 * plain text has a text baseline to align to, but a model row holds an icon
 * beside its name, and that value has no line box of its own: CSS then takes
 * the bottom of the value as its baseline and drops the label to the foot of
 * the taller row. One height for every row keeps the label beside its value
 * whatever the value is drawn from.
 */
const ROW_HEIGHT = "18px";

function SettingRow({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <HStack
      align="center"
      gap={3}
      width="full"
      minHeight={ROW_HEIGHT}
      data-testid={testId}
    >
      <Text
        fontSize="11.5px"
        color={FG_MUTED}
        width={LABEL_WIDTH}
        minWidth={LABEL_WIDTH}
        flexShrink={0}
      >
        {label}
      </Text>
      <Box
        minWidth={0}
        display="flex"
        alignItems="center"
        minHeight={ROW_HEIGHT}
      >
        {children}
      </Box>
    </HStack>
  );
}

function ModelRow({
  label,
  testId,
  model,
}: {
  label: string;
  testId: string;
  model: string | null;
}) {
  return (
    <SettingRow label={label} testId={testId}>
      {model ? (
        <LLMModelDisplay model={model} fontSize="12px" />
      ) : (
        <Text fontSize="12px" color={FG_MUTED}>
          {PROJECT_DEFAULT_MODEL}
        </Text>
      )}
    </SettingRow>
  );
}

/** One parameter as a chip: a literal, so it reads in a monospace font. */
function ParameterChip({ name, value }: { name: string; value: string }) {
  return (
    <Text
      as="code"
      fontFamily="mono"
      fontSize="11.5px"
      background="bg.muted"
      borderRadius="sm"
      paddingX={1.5}
      paddingY={0.5}
    >
      {`${name} = ${value}`}
    </Text>
  );
}

/** The overrides a target alone carried, as the block prints them. */
function overridesOf(target: BatchTarget): RunSettingParameter[] {
  return Object.entries(target.parameters ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, value: String(value) }));
}

/**
 * The targets the run went against, one line each: the mark of the kind of
 * agent behind it, its name, and its parameters as chips.
 *
 * The mark takes the colour of the target only in a comparison, where the
 * colour is what tells one column and one line of the page from another. A
 * run against one target has nothing to tell apart.
 */
function TargetsRow({
  targets,
  isComparison,
  parametersOf,
  instanceOf,
}: {
  targets: BatchTarget[];
  /** Whether the run went against more than one target. */
  isComparison: boolean;
  parametersOf: (target: BatchTarget) => RunSettingParameter[];
  /** The connected agent instance that served the target, when one did. */
  instanceOf: (target: BatchTarget) => string | undefined;
}) {
  return (
    <SettingRow label="Targets" testId="run-settings-targets">
      <VStack align="stretch" gap={1} paddingY="1px">
        {targets.map((target) => (
          <HStack
            key={target.key}
            gap={2}
            flexWrap="wrap"
            minHeight={ROW_HEIGHT}
            data-testid={`run-settings-target-${target.key}`}
          >
            <TargetMark
              kind={target.kind}
              color={isComparison ? target.color : undefined}
              testId={`run-settings-mark-${target.key}`}
            />
            <Text fontSize="12px">{target.name}</Text>
            {target.environmentLabel ? (
              <Text
                fontSize="11.5px"
                color={FG_MUTED}
                data-testid={`run-settings-target-environment-${target.key}`}
              >
                {target.environmentLabel}
              </Text>
            ) : null}
            {instanceOf(target) ? (
              <Text
                fontSize="11.5px"
                color={FG_MUTED}
                data-testid={`run-settings-target-instance-${target.key}`}
              >
                {`served by ${instanceOf(target)}`}
              </Text>
            ) : null}
            {parametersOf(target).map((parameter) => (
              <ParameterChip
                key={parameter.name}
                name={parameter.name}
                value={parameter.value}
              />
            ))}
          </HStack>
        ))}
      </VStack>
    </SettingRow>
  );
}

export function RunSettingsBlock({
  settings,
  targets,
  startedLabel,
  startedByLabel,
}: {
  settings: RunSettings;
  /** The targets of the run, in order and in colour. */
  targets: BatchTarget[];
  /** The date and the age of the run, or nothing when neither is known. */
  startedLabel: string | null;
  /**
   * Who started the run, in the words the reader knows them by, or nothing
   * when the run recorded no person. Never a placeholder.
   */
  startedByLabel: string | null;
}) {
  const startedRow = [startedLabel, startedByLabel]
    .filter((part): part is string => !!part)
    .join(" · ");
  // A comparison reads every value on the target lines and nothing under
  // them; a run against one target reads its overrides on the line and the
  // run-level values on their own row.
  const isComparison = targets.length > 1;
  const parametersOf = (target: BatchTarget) =>
    isComparison
      ? (settings.parametersByTarget.get(target.key) ?? [])
      : overridesOf(target);

  return (
    <VStack
      align="stretch"
      gap={2}
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      paddingX={3}
      paddingY={2.5}
      data-testid="run-settings-block"
    >
      {startedRow ? (
        <SettingRow label="Started" testId="run-settings-started">
          <Text fontSize="12px">{startedRow}</Text>
        </SettingRow>
      ) : null}

      {targets.length > 0 ? (
        <TargetsRow
          targets={targets}
          isComparison={isComparison}
          parametersOf={parametersOf}
          instanceOf={(target) => settings.instanceByTarget.get(target.key)}
        />
      ) : null}

      {!isComparison && settings.parameters.length > 0 ? (
        <SettingRow label="Parameters" testId="run-settings-parameters">
          <HStack gap={2} flexWrap="wrap">
            {settings.parameters.map((parameter) => (
              <ParameterChip
                key={parameter.name}
                name={parameter.name}
                value={parameter.value}
              />
            ))}
          </HStack>
        </SettingRow>
      ) : null}

      {settings.repeatCount > 1 ? (
        <SettingRow label="Repeat" testId="run-settings-repeat">
          <Text fontSize="12px">{settings.repeatCount} times</Text>
        </SettingRow>
      ) : null}

      {settings.simulatorModel ? (
        <ModelRow
          label="Simulator model"
          testId="run-settings-simulator"
          model={settings.simulatorModel}
        />
      ) : null}

      <ModelRow
        label="Judge model"
        testId="run-settings-judge"
        model={settings.judgeModel}
      />
    </VStack>
  );
}
