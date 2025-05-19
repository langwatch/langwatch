import {
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Trash2 } from "react-feather";
import { useFieldArray, useForm, type FieldErrors } from "react-hook-form";
import { slugify } from "~/utils/slugify";
import { Drawer } from "../components/ui/drawer";
import { toaster } from "../components/ui/toaster";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { tryToMapPreviousColumnsToNewColumns } from "../optimization_studio/utils/datasetUtils";
import type {
  DatasetColumns,
  DatasetRecordEntry,
  DatasetRecordForm,
} from "../server/datasets/types";
import { datasetRecordFormSchema } from "../server/datasets/types.generated";
import { api } from "../utils/api";
import { useDrawer } from "./CurrentDrawer";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { DatasetPreview } from "./datasets/DatasetPreview";
import type { InMemoryDataset } from "./datasets/DatasetTable";

interface AddDatasetDrawerProps {
  datasetToSave?: Omit<InMemoryDataset, "datasetRecords"> & {
    datasetId?: string;
    datasetRecords?: InMemoryDataset["datasetRecords"];
  };
  open?: boolean;
  onClose?: () => void;
  onSuccess: (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => void;
}

type FormValues = {
  name: string;
  columnTypes: DatasetColumns;
};

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
        options
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
  const slug = slugify((name || "").replace("_", "-"), {
    lower: true,
    strict: true,
  });
  const columnTypes = watch("columnTypes");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!props.open]);

  const trpc = api.useContext();
  const onSubmit = (data: DatasetRecordForm) => {
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
                  data.columnTypes
                ),
                data.columnTypes
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
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
          reset();
          onClose();
          // Refetch the datasets to get the latest data
          trpc.dataset.getAll.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: props.datasetToSave?.datasetId
              ? "Error updating dataset"
              : "Error creating dataset",
            description: error.message,
            type: "error",
            placement: "top-end",
            meta: {
              closable: true,
            },
          });
        },
      }
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
            <Text paddingTop={5} fontSize="2xl">
              {props.datasetToSave?.datasetId
                ? "Edit Dataset"
                : props.datasetToSave
                ? "Save Dataset"
                : "New Dataset"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what this group of examples is
              going to focus on"
              invalid={!!errors.name}
            >
              <Input {...register("name")} />
              {slug && <Field.HelperText>slug: {slug}</Field.HelperText>}
              <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Columns"
              helper="Which columns should be present in the dataset"
              invalid={!!errors.columnTypes}
            >
              <VStack align="start">
                <VStack align="start" width="full">
                  {fields.map((field, index) => (
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
                          <option value="chat_messages">
                            json chat messages (OpenAI format)
                          </option>
                          <option value="spans">json spans</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      <Button size="sm" onClick={() => remove(index)}>
                        <Trash2 size={32} />
                      </Button>
                    </HStack>
                  ))}
                  <Field.ErrorText>
                    {errors.columnTypes?.message}
                  </Field.ErrorText>
                  <Button onClick={() => append({ name: "", type: "string" })}>
                    Add Column
                  </Button>
                </VStack>
              </VStack>
            </HorizontalFormControl>
            {props.datasetToSave?.datasetRecords && (
              <VStack align="start" gap={4} paddingY={6}>
                <HStack gap={2}>
                  <Heading size="md">Preview</Heading>
                  <Text fontSize="13px" color="gray.500">
                    {props.datasetToSave.datasetRecords.length} rows,{" "}
                    {columnTypes.length} columns
                  </Text>
                </HStack>
                <Box width="100%" overflowX="scroll">
                  <Box width={`${Math.max(20 * columnTypes.length, 100)}%`}>
                    <DatasetPreview
                      rows={tryToConvertRowsToAppropriateType(
                        tryToMapPreviousColumnsToNewColumns(
                          props.datasetToSave.datasetRecords.slice(0, 5),
                          props.datasetToSave.columnTypes,
                          columnTypes
                        ),
                        columnTypes
                      )}
                      columns={columnTypes.slice(0, 50)}
                    />
                  </Box>
                </Box>
              </VStack>
            )}
            <Button
              colorPalette="blue"
              type="submit"
              minWidth="fit-content"
              loading={upsertDataset.isLoading}
            >
              {props.datasetToSave ? "Save" : "Create Dataset"}
            </Button>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export const tryToConvertRowsToAppropriateType = (
  datasetRecords: DatasetRecordEntry[],
  columnTypes: DatasetColumns
) => {
  const typeForColumn = Object.fromEntries(
    columnTypes.map((col) => [col.name, col.type])
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
            `${value ?? ""}`.toLowerCase()
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
      } else if (type !== "string") {
        try {
          convertedRecord[key] = JSON.parse(value);
        } catch {}
      }
    }
    return convertedRecord;
  });
};
