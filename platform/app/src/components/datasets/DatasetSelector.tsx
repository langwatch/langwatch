import {
  Button,
  createListCollection,
  Field,
  HStack,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { type ReactNode, useEffect, useState } from "react";
import type { FieldErrors, Path, PathValue, UseFormSetValue } from "react-hook-form";
import type { Dataset } from "~/generated/prisma/client";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { Select } from "@langwatch/design-system/select";

/**
 * What the picker has to show. An empty dropdown renders identically whether
 * the list is still coming, genuinely empty, or failed to arrive, so the three
 * are kept apart here rather than collapsing into "no items": a slow project
 * reads as having no datasets, and a failed request reads as the same, which
 * is the one thing we know is false.
 */
type PickerState = "loading" | "unavailable" | "empty" | "ready";

const pickerStateOf = ({
  datasets,
  isLoading,
  isError,
}: {
  datasets: Dataset[] | undefined;
  isLoading: boolean;
  isError: boolean;
}): PickerState => {
  if (isLoading) return "loading";
  if (isError || datasets === undefined) return "unavailable";
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

interface DatasetSelectorProps<T extends { datasetId: string }> {
  datasets: Dataset[] | undefined;
  localStorageDatasetId: string;
  errors: FieldErrors<T>;
  setValue: UseFormSetValue<T>;
  onCreateNew: () => void;
  isLoading?: boolean;
  isError?: boolean;
  register?: never;
}

export function DatasetSelector<T extends { datasetId: string }>({
  datasets,
  localStorageDatasetId,
  errors,
  setValue,
  onCreateNew,
  isLoading = false,
  isError = false,
}: DatasetSelectorProps<T>) {
  const state = pickerStateOf({ datasets, isLoading, isError });

  const datasetCollection = createListCollection({
    items:
      datasets?.map((dataset) => ({
        label: dataset.name,
        value: dataset.id,
      })) ?? [],
  });

  const [selectedValue, setSelectedValue] = useState<string[]>(
    localStorageDatasetId ? [localStorageDatasetId] : [],
  );

  useEffect(() => {
    setSelectedValue(localStorageDatasetId ? [localStorageDatasetId] : []);
  }, [localStorageDatasetId]);

  return (
    <HorizontalFormControl
      label="Dataset"
      helper="Add to an existing dataset or create a new one"
      invalid={!!errors.datasetId}
    >
      {state === "loading" ? (
        <LoadingDatasets />
      ) : (
        <Select.Root
          collection={datasetCollection}
          value={selectedValue}
          disabled={state !== "ready"}
          onValueChange={(e) => {
            const value = e.value[0] ?? "";
            setSelectedValue(e.value);
            setValue("datasetId" as Path<T>, value as PathValue<T, Path<T>>);
          }}
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
      {errors.datasetId && (
        <Field.ErrorText>{errors.datasetId.message as ReactNode}</Field.ErrorText>
      )}
      <Button
        colorPalette="blue"
        onClick={() => {
          setSelectedValue([]);
          setValue("datasetId" as Path<T>, "" as PathValue<T, Path<T>>);
          onCreateNew();
        }}
        minWidth="fit-content"
        variant="plain"
        marginTop={2}
        fontWeight="normal"
      >
        + Create New
      </Button>
    </HorizontalFormControl>
  );
}
