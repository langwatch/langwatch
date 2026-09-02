import { Button, Field, HStack } from "@chakra-ui/react";
import {
  ScenarioParameterDefinitionsInput,
  type ScenarioFormController,
  type ScenarioFormData,
} from "../../index";
import { Controller, type FieldErrors, useFormState } from "react-hook-form";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Dialog } from "@langwatch/workflow-web/components/ui/dialog";

/**
 * Editor for the parameters a scenario declares, opened from the Parameters
 * group in the scenario editor footer.
 *
 * Rows are edited straight on the scenario form, so closing keeps what was
 * typed and nothing is stored until the scenario itself is saved.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */
export function ScenarioParametersDialog({
  open,
  onOpenChange,
  form,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ScenarioFormController;
}) {
  const { errors } = useFormState({ control: form.control });
  const { parametersError, parameterRowErrors } = readParameterErrors(errors);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      size="xl"
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <HStack gap={0}>
            <Dialog.Title>Parameters</Dialog.Title>
            <FieldInfoTooltip
              description='Named values a run supplies, so the same scenario can run against another account, tenant or region. The situation, the criteria and the target read them as "params.NAME", and whoever starts the run can override any default. A secret parameter carries no default: its value is supplied when the run starts, and only the target reads it, as "secrets.NAME".'
              testId="scenario-parameters-info"
            />
          </HStack>
        </Dialog.Header>
        <Dialog.Body>
          <Field.Root invalid={!!parametersError}>
            <Controller
              name="parameters"
              control={form.control}
              render={({ field }) => (
                <ScenarioParameterDefinitionsInput
                  value={field.value}
                  onChange={field.onChange}
                  rowErrors={parameterRowErrors}
                />
              )}
            />
            <Field.ErrorText>{parametersError}</Field.ErrorText>
          </Field.Root>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            colorPalette="blue"
            onClick={() => onOpenChange(false)}
            data-testid="scenario-parameters-done"
          >
            Done
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Validation messages for the parameters field.
 *
 * The schema reports a bad name or a duplicate against the row that carries it
 * and the twenty-parameter cap against the array itself, so both are read back
 * separately: a row message sits under its row, the array message under the
 * list.
 */
function readParameterErrors(errors: FieldErrors<ScenarioFormData>): {
  parametersError: string | undefined;
  parameterRowErrors: (string | undefined)[];
} {
  const parameters: unknown = errors.parameters;
  const rows = Array.isArray(parameters) ? (parameters as unknown[]) : [];
  return {
    parametersError:
      messageOf(parameters) ??
      messageOf((parameters as { root?: unknown } | undefined)?.root),
    parameterRowErrors: rows.map((row) => {
      const fields = (row ?? {}) as Record<string, unknown>;
      return (
        messageOf(fields.name) ??
        messageOf(fields.description) ??
        messageOf(fields.defaultValue)
      );
    }),
  };
}

function messageOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
