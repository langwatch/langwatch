import { Button, createListCollection, Field } from "@chakra-ui/react";
import type { Dataset } from "@prisma/client";
import { useEffect, useState, type ReactNode } from "react";
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
  register?: never;
}

export function DatasetSelector<T extends { datasetId: string }>({
  datasets,
  localStorageDatasetId,
  errors,
  setValue,
  onCreateNew,
}: DatasetSelectorProps<T>) {
  const datasetCollection = createListCollection({
    items:
      datasets?.map((dataset) => ({
        label: dataset.name,
        value: dataset.id,
      })) ?? [],
  });

  const [selectedValue, setSelectedValue] = useState<string[]>(
    localStorageDatasetId ? [localStorageDatasetId] : []
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
      <Select.Root
        collection={datasetCollection}
        value={selectedValue}
        onValueChange={(e) => {
          const value = e.value[0] ?? "";
          setSelectedValue(e.value);
          setValue("datasetId" as Path<T>, value as PathValue<T, Path<T>>);
        }}
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Select Dataset" />
        </Select.Trigger>
        <Select.Content portalled={false}>
          {datasetCollection.items.map((dataset) => (
            <Select.Item key={dataset.value} item={dataset} marginY={3}>
              {dataset.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
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
