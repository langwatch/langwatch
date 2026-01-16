import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Trash2 } from "react-feather";
import { type FieldErrors, useFieldArray, useForm } from "react-hook-form";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "../components/ui/drawer";
import { toaster } from "../components/ui/toaster";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { tryToMapPreviousColumnsToNewColumns } from "../optimization_studio/utils/datasetUtils";
import type {
  DatasetColumns,
  DatasetRecordInput,
  DatasetRecordForm,
} from "../server/datasets/types";
import { datasetRecordFormSchema } from "../server/datasets/types.generated";
import { api } from "../utils/api";
import { DatasetSlugDisplay } from "./datasets/DatasetSlugDisplay";
import type { InMemoryDataset } from "./datasets/DatasetTable";
import { useDatasetSlugValidation } from "./datasets/useDatasetSlugValidation";
import { HorizontalFormControl } from "./HorizontalFormControl";

export interface AddDatasetDrawerProps {
  datasetToSave?: Omit<InMemoryDataset, "datasetRecords"> & {
    datasetId?: string;
    // IDs are optional for new records - backend generates them with nanoid()
    datasetRecords?: Array<{ id?: string } & Record<string, unknown>>;
  };
  open?: boolean;
  onClose?: () => void;
  onSuccess: (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => void;
  /**
   * When true, skip saving to DB and just call onSuccess with the form data.
   * Useful for editing inline/in-memory datasets that shouldn't be persisted yet.
   * The button will show "Apply" instead of "Save".
   */
  localOnly?: boolean;
  /**
   * Optional: Show visibility toggle (eye icon) for each column.
   * Used in evaluations workbench to hide/show columns without affecting the dataset.
   */
  columnVisibility?: {
    hiddenColumns: Set<string>;
    onToggleVisibility: (columnName: string) => void;
  };
}

type FormValues = {
  name: string;
  columnTypes: DatasetColumns;
};

/**
 * This is a component that allows you to create a new dataset
 * or edit an existing one's columns.
 */
export function AddOrEditDatasetDrawer(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const upsertDataset = api.dataset.upsert.useMutation();
  const { closeDrawer } = useDrawer();
  const onClose = props.onClose ?? closeDrawer;
  const isOpen = props.open ?? true;

  const initialColumns: DatasetColumns = [
    { name: "trace_id", type: "string" },
    { name: "timestamp", type: "date" },
    { name: "input", type: "string" },
    { name: "output", type: "string" },
    { name: "contexts", type: "list" },
    { name: "total_cost", type: "number" },
    { name: "comments", type: "string" },
  ];

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    control,
  } = useForm<FormValues>({
    defaultValues: {
      name: props.datasetToSave?.name ?? "",
      columnTypes: props.datasetToSave?.columnTypes ?? initialColumns,
    },
    resolver: async (data, context, options) => {
      const result = await zodResolver(datasetRecordFormSchema)(
        data,
        context,
        options,
      );

      if (!data.name || data.name.trim() === "") {
        (result.errors as FieldErrors<DatasetRecordForm>).name = {
          type: "required",
          message: "Name is required",
        };
      }

      const columnNamesSet = new Set();
      for (const col of data.columnTypes) {
        if (col.name.trim() === "") {
          (result.errors as FieldErrors<DatasetRecordForm>).columnTypes = {
            type: "required",
            message: `Column name cannot be empty`,
          };
          break;
        }
        if (columnNamesSet.has(col.name)) {
          (result.errors as FieldErrors<DatasetRecordForm>).columnTypes = {
            type: "required",
            message: `Cannot have multiple columns with the same name: \`${col.name}\``,
          };
        }
        columnNamesSet.add(col.name);
      }
      return result;
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "columnTypes",
  });

  const name = watch("name");
  const columnTypes = watch("columnTypes");

  // Use custom hook for slug validation against a name + datasetId
  const { slugInfo, displaySlug, slugWillChange, dbSlug, resetSlugInfo } =
    useDatasetSlugValidation({
      name,
      datasetId: props.datasetToSave?.datasetId,
    });

  useEffect(() => {
    if (props.datasetToSave) {
      setTimeout(() => {
        reset({
          name: props.datasetToSave!.name ?? "",
          columnTypes: props.datasetToSave!.columnTypes,
        });
      }, 0);
    } else {
      reset({
        name: "",
        columnTypes: initialColumns,
      });
    }
    resetSlugInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!props.open]);

  const trpc = api.useContext();
  const onSubmit = (data: DatasetRecordForm) => {
    // For localOnly mode, skip DB save and just call onSuccess
    if (props.localOnly) {
      props.onSuccess({
        datasetId: props.datasetToSave?.datasetId ?? "",
        name: data.name,
        columnTypes: data.columnTypes,
      });
      reset();
      onClose();
      return;
    }

    upsertDataset.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: props.datasetToSave?.datasetId,
        name: data.name,
        columnTypes: data.columnTypes,
        ...(props.datasetToSave?.datasetRecords
          ? {
              datasetRecords: tryToConvertRowsToAppropriateType(
                tryToMapPreviousColumnsToNewColumns(
                  props.datasetToSave.datasetRecords,
                  props.datasetToSave.columnTypes,
                  data.columnTypes,
                ),
                data.columnTypes,
              ),
            }
          : {}),
      },
      {
        onSuccess: (data) => {
          props.onSuccess({
            datasetId: data.id,
            name: data.name,
            columnTypes: data.columnTypes as DatasetColumns,
          });
          toaster.create({
            title: props.datasetToSave?.datasetId
              ? "Dataset Updated"
              : props.datasetToSave
                ? "Dataset Saved"
                : "Dataset Created",
            description: props.datasetToSave?.datasetId
              ? `Successfully updated ${data.name} dataset`
              : `Successfully created ${data.name} dataset`,
            type: "success",
            meta: {
              closable: true,
            },
          });
          reset();
          onClose();
          // Refetch the datasets to get the latest data
          void trpc.dataset.getAll.invalidate();
        },
        onError: (error) => {
          // Check if it's a slug conflict error from backend
          const isConflictError =
            error.message.includes("already exists") ||
            (error as any).data?.code === "CONFLICT";

          toaster.create({
            title: props.datasetToSave?.datasetId
              ? "Error updating dataset"
              : "Error creating dataset",
            description: isConflictError
              ? "A dataset with this name already exists. Please choose a different name."
              : error.message,
            type: "error",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack>
            <Heading>
              {props.datasetToSave?.datasetId || props.localOnly
                ? "Edit Dataset"
                : props.datasetToSave
                  ? "Save Dataset"
                  : "New Dataset"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what this group of examples is
              going to focus on"
              invalid={!!errors.name || (slugInfo?.hasConflict ?? false)}
            >
              <Input {...register("name")} />
              <DatasetSlugDisplay
                marginLeft={1}
                marginTop={1}
                displaySlug={displaySlug}
                slugWillChange={slugWillChange}
                dbSlug={dbSlug}
                slugInfo={slugInfo}
              />
              <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Columns"
              helper="Which columns should be present in the dataset"
              invalid={!!errors.columnTypes}
            >
              <VStack align="start">
                <VStack align="start" width="full">
                  {fields.map((field, index) => {
                    const columnName = watch(`columnTypes.${index}.name`);
                    const isHidden = props.columnVisibility?.hiddenColumns.has(columnName);
                    return (
                      <HStack key={field.id} width="full" gap={2}>
                        <Input
                          {...register(`columnTypes.${index}.name`, {
                            required: "Column name cannot be empty",
                          })}
                          placeholder="Column name"
                        />
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            {...register(`columnTypes.${index}.type`)}
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="date">date</option>
                            <option value="list">list</option>
                            <option value="json">json</option>
                            <option value="image">image (URL)</option>
                            <option value="chat_messages">
                              json chat messages (OpenAI format)
                            </option>
                            <option value="spans">json spans</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        {props.columnVisibility && (
                          <IconButton
                            size="sm"
                            variant="ghost"
                            onClick={() => props.columnVisibility?.onToggleVisibility(columnName)}
                            color={isHidden ? "gray.400" : "gray.600"}
                            aria-label={isHidden ? "Show column" : "Hide column"}
                            title={isHidden ? "Show column" : "Hide column"}
                          >
                            {isHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                          </IconButton>
                        )}
                        <Button size="sm" onClick={() => remove(index)}>
                          <Trash2 size={32} />
                        </Button>
                      </HStack>
                    );
                  })}
                  <Field.ErrorText>
                    {errors.columnTypes?.message}
                  </Field.ErrorText>
                  <Button onClick={() => append({ name: "", type: "string" })}>
                    Add Column
                  </Button>
                </VStack>
              </VStack>
            </HorizontalFormControl>
            <Button
              colorPalette="blue"
              type="submit"
              minWidth="fit-content"
              loading={upsertDataset.isLoading}
            >
              {props.localOnly
                ? "Apply"
                : props.datasetToSave
                  ? "Save"
                  : "Create Dataset"}
            </Button>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export const tryToConvertRowsToAppropriateType = (
  datasetRecords: DatasetRecordInput[],
  columnTypes: DatasetColumns,
): DatasetRecordInput[] => {
  const typeForColumn = Object.fromEntries(
    columnTypes.map((col) => [col.name, col.type]),
  );
  return datasetRecords.map((record) => {
    const convertedRecord = { ...record };
    for (const [key, value] of Object.entries(record)) {
      const type = typeForColumn[key];
      if (type === "number") {
        if (!value) {
          convertedRecord[key] = null;
        } else if (!isNaN(value)) {
          convertedRecord[key] = parseFloat(value);
        }
      } else if (type === "boolean") {
        if (
          ["true", "1", "yes", "y", "on", "ok"].includes(
            `${value ?? ""}`.toLowerCase(),
          )
        ) {
          convertedRecord[key] = true;
        } else if (
          [
            "false",
            "0",
            "null",
            "undefined",
            "nan",
            "inf",
            "no",
            "n",
            "off",
          ].includes(`${value ?? ""}`.toLowerCase())
        ) {
          convertedRecord[key] = false;
        }
      } else if (type === "date") {
        const dateAttempt = new Date(value);
        if (dateAttempt.toString() !== "Invalid Date") {
          convertedRecord[key] = dateAttempt.toISOString().split("T")[0];
        }
      } else if (type === "image") {
        // Image type should be treated as a string (URL)
        convertedRecord[key] = value;
      } else if (type !== "string") {
        try {
          convertedRecord[key] = JSON.parse(value);
        } catch {
          /* */
        }
      }
    }
    return convertedRecord;
  });
};
