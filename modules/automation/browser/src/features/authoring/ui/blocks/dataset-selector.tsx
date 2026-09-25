/**
 * Dataset selector for ADD_TO_DATASET: value-controlled, creation via drawer hand-over.
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
      as="output"
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
