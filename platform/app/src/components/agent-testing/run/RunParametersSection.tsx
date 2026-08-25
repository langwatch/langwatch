/**
 * The parameter overrides of a run: one line for the plain values, and a
 * password field per secret, which cannot ride on the line.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, Input, VStack } from "@chakra-ui/react";
import { RunParameterFields } from "~/components/suites/RunParameterFields";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../shared/DialogFields";
import { RemoveBlockButton } from "./RemoveBlockButton";
import type { RunDialogForm } from "./useRunDialogForm";

export const PARAMETER_LINE_PLACEHOLDER = "plan=free, locale=de";

const PARAMETERS_HELP =
  "Parameters reach your agent as arguments of the function you annotated. Use them to run the same case as a free or a pro customer, in another locale, or on another model.";

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
    <VStack align="stretch" gap={2} data-testid="run-dialog-parameters">
      <Box>
        <FieldLabel>
          Parameters
          <FieldInfoTooltip
            description={PARAMETERS_HELP}
            docHref="/agent-simulations/scenario-parameters"
            docLabel="How to annotate an agent"
            trigger="hover"
            testId="run-parameters-info"
          />
          <RemoveBlockButton
            label="Remove the parameter overrides"
            onClick={form.hideParameters}
          />
        </FieldLabel>
        <Input
          {...DIALOG_FIELD_STYLE}
          fontFamily="mono"
          fontSize="12px"
          aria-label="Parameter overrides"
          placeholder={PARAMETER_LINE_PLACEHOLDER}
          value={form.parameterLine}
          onChange={(event) => form.setParameterLine(event.target.value)}
          disabled={isBusy}
          data-testid="run-dialog-parameter-line"
        />
      </Box>
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
