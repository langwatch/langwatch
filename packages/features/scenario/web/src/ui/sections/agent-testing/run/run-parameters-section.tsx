/**
 * The parameter overrides of a run: one line for the plain values, or one row
 * per parameter once a value must stay hidden.
 *
 * The line is the small case and stays the default. The "Secret parameters"
 * toggle turns it into rows, where every row carries a lock, and the secrets
 * the cases declare join the same list.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra, Input, Text, VStack } from "@chakra-ui/react";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../../../elements/agent-testing/shared/dialog-fields";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";
import { RemoveBlockButton } from "../../../elements/agent-testing/shared/remove-block-button";
import { ParameterRowsEditor } from "../../../elements/agent-testing/run/parameter-rows-editor";
import type { RunDialogForm } from "./use-run-dialog-form";

export const PARAMETER_LINE_PLACEHOLDER = "plan=free, locale=de";

const PARAMETERS_HELP =
  "Parameters reach your agent as arguments of the function you annotated. Use them to run the same case as a free or a pro customer, in another locale, or on another model.";

/** Why the toggle cannot go back once a row holds a credential. */
export const LOCKED_IN_ROWS_MESSAGE =
  "A secret value cannot be written on one line, so the rows stay.";

type RunParametersFields = Pick<
  RunDialogForm,
  | "parameterLine"
  | "editParameterLine"
  | "parameterRows"
  | "showParameterRows"
  | "canLeaveParameterRows"
  | "setParameterRowsMode"
  | "updateParameterRow"
  | "addParameterRow"
  | "removeParameterRow"
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
  const isLockedInRows = form.showParameterRows && !form.canLeaveParameterRows;

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
          <chakra.span
            display="flex"
            alignItems="center"
            gap={1.5}
            marginLeft="auto"
          >
            <Tooltip
              content={LOCKED_IN_ROWS_MESSAGE}
              disabled={!isLockedInRows}
              positioning={{ placement: "top" }}
            >
              <chakra.span
                display="flex"
                alignItems="center"
                gap={1.5}
                opacity={isLockedInRows ? 0.6 : 1}
                title={isLockedInRows ? LOCKED_IN_ROWS_MESSAGE : undefined}
                data-testid="run-dialog-secret-parameters-toggle"
              >
                <Text as="span" fontSize="11.5px" color={FG_MUTED}>
                  Secret parameters
                </Text>
                <Switch
                  size="sm"
                  checked={form.showParameterRows}
                  disabled={isBusy || isLockedInRows}
                  onCheckedChange={(event) =>
                    form.setParameterRowsMode(event.checked)
                  }
                  inputProps={{
                    "data-testid": "run-dialog-secret-parameters",
                  }}
                  aria-label="Secret parameters"
                />
              </chakra.span>
            </Tooltip>
            <RemoveBlockButton
              label="Remove the parameter overrides"
              onClick={form.hideParameters}
            />
          </chakra.span>
        </FieldLabel>
        {form.showParameterRows ? (
          <ParameterRowsEditor
            rows={form.parameterRows}
            onChangeRow={form.updateParameterRow}
            onAddRow={form.addParameterRow}
            onRemoveRow={form.removeParameterRow}
            declaredSecrets={form.secretDefinitions}
            secretValues={form.secretValues}
            onChangeSecretValue={form.setSecretValue}
            disabled={isBusy}
          />
        ) : (
          <Input
            {...DIALOG_FIELD_STYLE}
            fontFamily="mono"
            fontSize="12px"
            aria-label="Parameter overrides"
            placeholder={PARAMETER_LINE_PLACEHOLDER}
            value={form.parameterLine}
            onChange={(event) => form.editParameterLine(event.target.value)}
            disabled={isBusy}
            data-testid="run-dialog-parameter-line"
          />
        )}
      </Box>
    </VStack>
  );
}
