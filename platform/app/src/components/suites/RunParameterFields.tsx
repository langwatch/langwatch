/**
 * The parameters a run can carry, as fields.
 *
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";

/** What a secret parameter with no value yet says under its field. */
const MISSING_SECRET_MESSAGE = "Type the value to start the run.";

/**
 * One input per parameter the run can carry, prefilled with the value the run
 * would use if nothing here is touched.
 *
 * A secret parameter is the exception: it has no default, its field hides what
 * is typed, and the run waits for it.
 */
export function RunParameterFields({
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
          <Text
            fontSize="sm"
            fontFamily="mono"
            truncate
            paddingLeft={isSecret ? 1 : 0}
          >
            {parameter.name}
          </Text>
          {parameter.description && (
            <FieldInfoTooltip
              description={parameter.description}
              testId={`suite-run-param-info-${parameter.name}`}
            />
          )}
        </HStack>
        <Input
          size="sm"
          flex={1}
          fontFamily="mono"
          fontSize="13px"
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
