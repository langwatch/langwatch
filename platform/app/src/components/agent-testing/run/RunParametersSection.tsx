/**
 * The parameter overrides of a run: one line for the plain values, and a
 * password field per secret, which cannot ride on the line.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { RunParameterFields } from "~/components/suites/RunParameterFields";
import type { RunDialogForm } from "./useRunDialogForm";

/** What the one parameter line reads when it is empty. */
export const PARAMETER_LINE_PLACEHOLDER = "plan=free, locale=de";

type RunParametersFields = Pick<
  RunDialogForm,
  | "parameterLine"
  | "setParameterLine"
  | "secretDefinitions"
  | "secretValues"
  | "setSecretValue"
  | "hideParameters"
>;

export function RunParametersSection({
  form,
  isBusy,
}: {
  form: RunParametersFields;
  isBusy: boolean;
}) {
  return (
    <VStack align="stretch" gap={1} data-testid="run-dialog-parameters">
      <HStack gap={1}>
        <Text fontSize="xs" fontWeight="medium" color="fg.muted">
          Parameters
        </Text>
        <Button
          size="2xs"
          variant="ghost"
          color="fg.muted"
          aria-label="Remove the parameter overrides"
          onClick={form.hideParameters}
        >
          <X size={12} />
        </Button>
      </HStack>
      <Input
        size="sm"
        fontFamily="mono"
        fontSize="13px"
        aria-label="Parameter overrides"
        placeholder={PARAMETER_LINE_PLACEHOLDER}
        value={form.parameterLine}
        onChange={(event) => form.setParameterLine(event.target.value)}
        disabled={isBusy}
        data-testid="run-dialog-parameter-line"
      />
      {form.secretDefinitions.length > 0 && (
        <RunParameterFields
          title="Secret parameters"
          parameters={form.secretDefinitions}
          values={form.secretValues}
          onChange={form.setSecretValue}
          disabled={isBusy}
        />
      )}
    </VStack>
  );
}
