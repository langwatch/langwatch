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
 * Creating a dataset is offered as a hand-over rather than a second form: the
 * caller passes `onCreateNew` and the host takes the reader to the dataset
 * drawer and back. A project with no dataset has nothing to pick, so without
 * it that section has no way out.
 *
 * The three-way state is kept: an empty dropdown renders identically whether
 * the list is still coming, genuinely empty, or failed to arrive, and only one
 * of the three is "you have no datasets".
 */

import {
  Button,
  createListCollection,
  Field,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Select } from "@langwatch/design-system/select";
import { Plus } from "lucide-react";

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
  onCreateNew,
}: {
  datasets: DatasetOption[] | undefined;
  value: string;
  onChange: (datasetId: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  /** Hands over to the dataset drawer. Omitted where there is nowhere to hand over to. */
  onCreateNew?: () => void;
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
        {onCreateNew ? (
          <Button alignSelf="flex-start" onClick={onCreateNew} size="xs" variant="ghost">
            <Plus size={14} /> Create a new dataset
          </Button>
        ) : null}
        <Field.HelperText>Add matched traces to a dataset.</Field.HelperText>
      </VStack>
    </Field.Root>
  );
}
