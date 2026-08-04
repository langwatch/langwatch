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
  // click that would open nothing. A failed request leaves no datasets either,
  // and telling someone they have none when we simply could not ask is worse
  // than saying nothing worked — so only a list that actually arrived empty
  // counts as empty.
  const hasLoaded = !isLoading && !isError && datasets !== undefined;
  const isEmpty = hasLoaded && datasetCollection.items.length === 0;
  const isUnavailable = isError || (!isLoading && datasets === undefined);

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
          role="status"
          aria-label="Loading datasets"
        >
          <Spinner size="xs" />
          <Text textStyle="sm">Loading datasets...</Text>
        </HStack>
      ) : (
        <Select.Root
          collection={datasetCollection}
          value={selectedValue}
          disabled={isEmpty || isUnavailable}
          onValueChange={(e) => {
            const value = e.value[0] ?? "";
            setSelectedValue(e.value);
            setValue("datasetId" as Path<T>, value as PathValue<T, Path<T>>);
          }}
        >
          <Select.Trigger>
            <Select.ValueText
              placeholder={
                isUnavailable
                  ? "Could not load datasets"
                  : isEmpty
                    ? "No datasets yet"
                    : "Select Dataset"
              }
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
