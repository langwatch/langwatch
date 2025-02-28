import { Button, Field, NativeSelect } from "@chakra-ui/react";
import { type Dataset } from "@prisma/client";
import {
  type UseFormRegister,
  type UseFormSetValue,
  type FieldErrors,
  type Path,
  type PathValue,
} from "react-hook-form";
import { HorizontalFormControl } from "../HorizontalFormControl";
import type { ReactNode } from "react";

interface DatasetSelectorProps<T extends { datasetId: string }> {
  datasets: Dataset[] | undefined;
  localStorageDatasetId: string;
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  setValue: UseFormSetValue<T>;
  onCreateNew: () => void;
}

export function DatasetSelector<T extends { datasetId: string }>({
  datasets,
  localStorageDatasetId,
  register,
  errors,
  setValue,
  onCreateNew,
}: DatasetSelectorProps<T>) {
  return (
    <HorizontalFormControl
      label="Dataset"
      helper="Add to an existing dataset or create a new one"
      invalid={!!errors.datasetId}
    >
      <NativeSelect.Root>
        <NativeSelect.Field
          {...register("datasetId" as Path<T>, {
            required: "Dataset is required",
          })}
        >
          <option value="">Select Dataset</option>
          {datasets?.map((dataset, index) => (
            <option
              key={index}
              value={dataset.id}
              selected={dataset.id === localStorageDatasetId}
            >
              {dataset.name}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {errors.datasetId && (
        <Field.ErrorText>
          {errors.datasetId.message as ReactNode}
        </Field.ErrorText>
      )}
      <Button
        colorPalette="blue"
        onClick={() => {
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
