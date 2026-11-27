import { Field, Input, NativeSelect } from "@langwatch/design-system/primitives";

import type { ConnectorDatasetOption } from "../../model/connector-form.ts";

/** The dataset whose rows every block receives; a saved one since deleted stays selectable. */
export function ConnectorDatasetField({
  datasets,
  fixturesDatasetId,
  onChange,
}: {
  datasets: readonly ConnectorDatasetOption[];
  fixturesDatasetId: string;
  onChange: (fixturesDatasetId: string) => void;
}) {
  const isMissing =
    fixturesDatasetId !== "" && !datasets.some((dataset) => dataset.id === fixturesDatasetId);
  return (
    <Field.Root>
      <Field.Label>Fixtures dataset</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={fixturesDatasetId}
          onChange={(event) => onChange(event.target.value)}
          data-testid="connector-dataset-select"
        >
          <option value="">No fixtures dataset</option>
          {datasets.map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name}
            </option>
          ))}
          {isMissing && <option value={fixturesDatasetId}>A dataset that no longer exists</option>}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Field.HelperText>Every block receives its rows as input["rows"].</Field.HelperText>
    </Field.Root>
  );
}

export function ConnectorTimeoutField({
  timeoutSeconds,
  error,
  onChange,
}: {
  timeoutSeconds: string;
  error: string | undefined;
  onChange: (timeoutSeconds: string) => void;
}) {
  return (
    <Field.Root invalid={Boolean(error)}>
      <Field.Label>Call timeout (seconds)</Field.Label>
      <Input
        type="number"
        min={1}
        value={timeoutSeconds}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Default"
        data-testid="connector-timeout-input"
      />
      <Field.HelperText>How long the call block may take each turn.</Field.HelperText>
      {error && <Field.ErrorText>{error}</Field.ErrorText>}
    </Field.Root>
  );
}
