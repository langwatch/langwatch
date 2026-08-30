/**
 * The parameter overrides of a run: one line for the plain values, or one row
 * per parameter once a value must stay hidden.
 *
 * The line is the simple case and stays the default. The "Secret parameters"
 * toggle turns it into rows, where every row carries a lock, and the secrets
 * the scenarios declare join the same list.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra, Text, VStack } from "@chakra-ui/react";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { Switch } from "~/components/ui/switch";
import { Tooltip } from "~/components/ui/tooltip";
import { FieldLabel } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import { ParameterLineField } from "./ParameterLineField";
import { ParameterRowsEditor } from "./ParameterRowsEditor";
import { errorOnLine, parameterPlaceholder } from "./parameter-suggestions";
import type { RunDialogForm } from "./useRunDialogForm";

const PARAMETERS_HELP =
  "Parameters reach your agent as arguments of the function you annotated. Use them to run the same scenario as a free or a pro customer, in another locale, or on another model.";

/** Why the toggle cannot go back once a row holds a credential. */
export const LOCKED_IN_ROWS_MESSAGE =
  "A secret value cannot be written on one line, so the rows stay.";

type RunParametersFields = Pick<
  RunDialogForm,
  | "parameterDefinitions"
  | "parameterError"
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

/** The switch that turns the single line into one row per parameter. */
function SecretParametersToggle({
  isOn,
  isLockedInRows,
  disabled,
  onToggle,
}: {
  isOn: boolean;
  /** True while a credential holds the block in its rows. */
  isLockedInRows: boolean;
  disabled: boolean;
  onToggle: (wanted: boolean) => void;
}) {
  return (
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
          checked={isOn}
          disabled={disabled}
          onCheckedChange={(event) => onToggle(event.checked)}
          inputProps={{
            "data-testid": "run-dialog-secret-parameters",
          }}
          aria-label="Secret parameters"
        />
      </chakra.span>
    </Tooltip>
  );
}

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
            <SecretParametersToggle
              isOn={form.showParameterRows}
              isLockedInRows={isLockedInRows}
              disabled={isBusy || isLockedInRows}
              onToggle={form.setParameterRowsMode}
            />
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
            definitions={form.parameterDefinitions}
            error={form.parameterError}
            disabled={isBusy}
          />
        ) : (
          <ParameterLineField
            ariaLabel="Parameter overrides"
            placeholder={parameterPlaceholder(form.parameterDefinitions)}
            value={form.parameterLine}
            onChange={form.editParameterLine}
            definitions={form.parameterDefinitions}
            error={errorOnLine({
              line: form.parameterLine,
              error: form.parameterError,
            })}
            disabled={isBusy}
            testId="run-dialog-parameter-line"
          />
        )}
      </Box>
    </VStack>
  );
}
