import {
  Button,
  createListCollection,
  Field,
  HStack,
  Spinner,
  Text,
} from "@chakra-ui/react";
import type { Dataset } from "@prisma/client";
import { type ReactNode, useEffect, useState } from "react";
import type {
  FieldErrors,
  Path,
  PathValue,
  UseFormSetValue,
} from "react-hook-form";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { Select } from "../ui/select";

interface DatasetSelectorProps<T extends { datasetId: string }> {
  datasets: Dataset[] | undefined;
  localStorageDatasetId: string;
  errors: FieldErrors<T>;
  setValue: UseFormSetValue<T>;
  onCreateNew: () => void;
  isLoading?: boolean;
  register?: never;
}

export function DatasetSelector<T extends { datasetId: string }>({
  datasets,
  localStorageDatasetId,
  errors,
  setValue,
  onCreateNew,
  isLoading = false,
}: DatasetSelectorProps<T>) {
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

  // An empty dropdown looks exactly like a project with no datasets, so while
  // the list is in flight the trigger says so outright rather than inviting a
  // click that would open nothing.
  const isEmpty = !isLoading && datasetCollection.items.length === 0;

  return (
    <HorizontalFormControl
      label="Dataset"
      helper="Add to an existing dataset or create a new one"
      invalid={!!errors.datasetId}
    >
      {isLoading ? (
        <HStack
          height="40px"
          paddingX={3}
          gap={2}
          borderWidth="1px"
          borderRadius="md"
          color="fg.muted"
          aria-live="polite"
        >
          <Spinner size="xs" />
          <Text textStyle="sm">Loading datasets...</Text>
        </HStack>
      ) : (
        <Select.Root
          collection={datasetCollection}
          value={selectedValue}
          disabled={isEmpty}
          onValueChange={(e) => {
            const value = e.value[0] ?? "";
            setSelectedValue(e.value);
            setValue("datasetId" as Path<T>, value as PathValue<T, Path<T>>);
          }}
        >
          <Select.Trigger>
            <Select.ValueText
              placeholder={isEmpty ? "No datasets yet" : "Select Dataset"}
            />
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
        <Field.ErrorText>
          {errors.datasetId.message as ReactNode}
        </Field.ErrorText>
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
