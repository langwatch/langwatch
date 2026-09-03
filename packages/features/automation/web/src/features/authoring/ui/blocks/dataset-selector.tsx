/**
 * Which dataset an ADD_TO_DATASET automation writes to.
 *
 * A family-local copy of `platform/app`'s `components/datasets/DatasetSelector`,
 * with two changes.
 *
 * It is controlled by a value and a change handler rather than by
 * `react-hook-form`'s `setValue`: the application's version is generic over a
 * form shape because it serves form-backed callers, and this family's one
 * caller passed a hand-written shim to bridge the two.
 *
 * "+ Create New" is gone. It opened the application's dataset drawer, which is
 * composition this package may not reach, and writing the drawer's address into
 * the query string would change the URL and open nothing while the automations
 * screen is served from `apps/ui` — the same chrome gap the me family recorded.
 * Picking an existing dataset is unaffected; creating one is done from the
 * datasets page. Recorded in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * The three-way state is kept: an empty dropdown renders identically whether
 * the list is still coming, genuinely empty, or failed to arrive, and only one
 * of the three is "you have no datasets".
 */

import { createListCollection, Field, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Select } from "@langwatch/design-system/select";

type DatasetOption = { id: string; name: string };

type PickerState = "loading" | "unavailable" | "empty" | "ready";

const pickerStateOf = ({
  datasets,
  isLoading,
  isError,
}: {
  datasets: DatasetOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
}): PickerState => {
  if (isLoading) return "loading";
  if (isError || datasets === void 0) return "unavailable";
  if (datasets.length === 0) return "empty";
  return "ready";
};

const PLACEHOLDER: Record<Exclude<PickerState, "loading">, string> = {
  unavailable: "Could not load datasets",
  empty: "No datasets yet",
  ready: "Select Dataset",
};

function LoadingDatasets() {
  return (
    <HStack
      height="40px"
      paddingX={3}
      gap={2}
      borderWidth="1px"
      borderRadius="md"
      color="fg.muted"
      role="status"
      aria-label="Loading datasets"
    >
      <Spinner size="xs" />
      <Text textStyle="sm">Loading datasets...</Text>
    </HStack>
  );
}

export function DatasetSelector({
  datasets,
  value,
  onChange,
  isLoading = false,
  isError = false,
}: {
  datasets: DatasetOption[] | undefined;
  value: string;
  onChange: (datasetId: string) => void;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const state = pickerStateOf({ datasets, isLoading, isError });

  const datasetCollection = createListCollection({
    items: (datasets ?? []).map((dataset) => ({ label: dataset.name, value: dataset.id })),
  });

  return (
    <Field.Root>
      <VStack align="stretch" gap={1} width="full">
        <Field.Label>Dataset</Field.Label>
        {state === "loading" ? (
          <LoadingDatasets />
        ) : (
          <Select.Root
            collection={datasetCollection}
            value={value ? [value] : []}
            disabled={state !== "ready"}
            onValueChange={(event) => onChange(event.value[0] ?? "")}
          >
            <Select.Trigger>
              <Select.ValueText placeholder={PLACEHOLDER[state]} />
            </Select.Trigger>
            <Select.Content portalled={false}>
              {datasetCollection.items.map((dataset) => (
                <Select.Item key={dataset.value} item={dataset}>
                  {dataset.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        <Field.HelperText>Add matched traces to an existing dataset.</Field.HelperText>
      </VStack>
    </Field.Root>
  );
}
