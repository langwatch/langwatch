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
 * The run note is not here. It reads in the header line and does not move.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import { FG_MUTED } from "../shared/design";
import type { RunSettings } from "./run-settings";

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
    <HStack align="baseline" gap={3} width="full" data-testid={testId}>
      <Text
        fontSize="11.5px"
        color={FG_MUTED}
        width={LABEL_WIDTH}
        minWidth={LABEL_WIDTH}
        flexShrink={0}
      >
        {label}
      </Text>
      <Box minWidth={0}>{children}</Box>
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

export function RunSettingsBlock({
  settings,
  startedLabel,
  startedByLabel,
}: {
  settings: RunSettings;
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

      {settings.parameters.length > 0 ? (
        <SettingRow label="Parameters" testId="run-settings-parameters">
          <HStack gap={2} flexWrap="wrap">
            {settings.parameters.map((parameter) => (
              <Text
                key={parameter.name}
                as="code"
                fontFamily="mono"
                fontSize="11.5px"
                background="bg.muted"
                borderRadius="sm"
                paddingX={1.5}
                paddingY={0.5}
              >
                {`${parameter.name} = ${parameter.value}`}
              </Text>
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
