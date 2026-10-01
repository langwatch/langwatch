import { Button, Field, HStack, IconButton, Input, NativeSelect, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WireOf } from "@langwatch/api/web";
import { describeError, showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import {
  type DatasetApiUpsertOutput,
  type DatasetColumns,
  type DatasetRecordForm,
  datasetRecordFormSchema,
  type InMemoryDataset,
} from "@langwatch/dataset-contract";
import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { tryToMapPreviousColumnsToNewColumns } from "@langwatch/workflow-browser-kit";
import { useEffect } from "react";
import { Eye, EyeOff, Trash2 } from "react-feather";
import { type FieldErrors, type Resolver, useFieldArray, useForm } from "react-hook-form";

import { datasetApi } from "../../../behavior/dataset-api.ts";
import { useDatasetSlugValidation } from "../../../behavior/datasets/use-dataset-slug-validation.ts";
import { convertDatasetRecordsToColumnTypes } from "../../../model/convert-record-values.ts";
import { DatasetSlugDisplay } from "./dataset-slug-display.tsx";

export interface AddDatasetDrawerProps {
  datasetToSave?: Omit<InMemoryDataset, "datasetRecords"> & {
    datasetId?: string;
    // IDs are optional for new records - backend generates them with nanoid()
    datasetRecords?: ({ id?: string } & Record<string, unknown>)[];
  };
  open?: boolean;
  onClose?: () => void;
  /**
   * Optional: a bare-URL open (`?drawer.open=addOrEditDataset`) has no
   * caller to hand one in, so it must create and close via `onClose` alone.
   */
  onSuccess?: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumns }) => void;
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
  /**
   * When true, the column set is fixed (rename/retype only, no add/remove).
   * Used by the upload confirm step (ADR-032 v19), whose columns must stay
   * positionally aligned with the file header the normalize job parsed.
   */
  isColumnsLocked?: boolean;
}

type FormValues = {
  name: string;
  columnTypes: DatasetColumns;
};

/** Columns a freshly created dataset starts with, matching the trace fields
 *  a record carries by default. */
type SavedDataset = { datasetId?: string } | undefined;

function datasetDrawerHeading({
  datasetToSave,
  isEditing,
}: {
  datasetToSave: SavedDataset;
  isEditing: boolean;
}): string {
  if (isEditing) return "Edit Dataset";

  return datasetToSave ? "Save Dataset" : "New Dataset";
}

function datasetSubmitLabel({
  datasetToSave,
  localOnly,
}: {
  datasetToSave: SavedDataset;
  localOnly: boolean;
}): string {
  if (localOnly) return "Apply";

  return datasetToSave ? "Save" : "Create Dataset";
}

function datasetSavedTitle(datasetToSave: SavedDataset): string {
  if (datasetToSave?.datasetId) return "Dataset Updated";

  return datasetToSave ? "Dataset Saved" : "Dataset Created";
}

export const DATASET_DEFAULT_COLUMNS: DatasetColumns = [
  { name: "trace_id", type: "string" },
  { name: "timestamp", type: "date" },
  { name: "input", type: "string" },
  { name: "output", type: "string" },
  { name: "contexts", type: "list" },
  { name: "total_cost", type: "number" },
  { name: "annotations", type: "string" },
];

/**
 * This is a component that allows you to create a new dataset
 * or edit an existing one's columns.
 */
/** Why the column list cannot be saved: an empty name, or two columns sharing one. */
function columnTypesError(columns: FormValues["columnTypes"]): string | undefined {
  const seen = new Set<string>();
  let duplicate: string | undefined;
  for (const col of columns) {
    if (col.name.trim() === "") return "Column name cannot be empty";
    if (seen.has(col.name))
      duplicate = `Cannot have multiple columns with the same name: \`${col.name}\``;
    seen.add(col.name);
  }
  return duplicate;
}

/** The schema's verdict, plus a required name and a column list that can be saved. */
const validateDatasetForm: Resolver<FormValues> = async (data, context, options) => {
  const result = await zodResolver(datasetRecordFormSchema)(data, context, options);
  const errors = result.errors as FieldErrors<DatasetRecordForm>;

  if (!data.name || data.name.trim() === "") {
    errors.name = { type: "required", message: "Name is required" };
  }
  const columnsMessage = columnTypesError(data.columnTypes);
  if (columnsMessage) errors.columnTypes = { type: "required", message: columnsMessage };

  return result;
};

/** The upsert as the form submits it, with remapped records when a dataset is edited. */
function upsertInputOf({
  projectId,
  datasetToSave,
  data,
}: {
  projectId: string;
  datasetToSave: AddDatasetDrawerProps["datasetToSave"];
  data: DatasetRecordForm;
}) {
  const base = {
    projectId,
    datasetId: datasetToSave?.datasetId,
    name: data.name,
    columnTypes: data.columnTypes,
  };
  if (!datasetToSave?.datasetRecords) return base;

  const remapped = tryToMapPreviousColumnsToNewColumns(
    datasetToSave.datasetRecords,
    datasetToSave.columnTypes,
    data.columnTypes,
  );
  return {
    ...base,
    datasetRecords: convertDatasetRecordsToColumnTypes(remapped, data.columnTypes),
  };
}

/** Resets the form to the edited dataset (after layout) or a blank one; answers the cancel. */
function resetDrawerForm({
  reset,
  datasetToSave,
  initialColumns,
}: {
  reset: (values: FormValues) => void;
  datasetToSave: AddDatasetDrawerProps["datasetToSave"];
  initialColumns: FormValues["columnTypes"];
}): () => void {
  if (!datasetToSave) {
    reset({ name: "", columnTypes: initialColumns });
    return () => undefined;
  }
  const timeout = setTimeout(() => {
    reset({ name: datasetToSave.name ?? "", columnTypes: datasetToSave.columnTypes });
  }, 0);
  return () => clearTimeout(timeout);
}

export function AddOrEditDatasetDrawer(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const upsertDataset = datasetApi.dataset.upsert.useMutation();
  const { closeDrawer } = useDrawer();
  const onClose = props.onClose ?? closeDrawer;
  const isOpen = props.open ?? true;

  const initialColumns = DATASET_DEFAULT_COLUMNS;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    setError,
    control,
  } = useForm<FormValues>({
    defaultValues: {
      name: props.datasetToSave?.name ?? "",
      columnTypes: props.datasetToSave?.columnTypes ?? initialColumns,
    },
    resolver: validateDatasetForm,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "columnTypes",
  });

  const name = watch("name");

  // Use custom hook for slug validation against a name + datasetId
  const { slugInfo, displaySlug, slugWillChange, dbSlug, resetSlugInfo } = useDatasetSlugValidation(
    {
      name,
      datasetId: props.datasetToSave?.datasetId,
    },
  );

  useEffect(() => {
    const cancelReset = resetDrawerForm({
      reset,
      datasetToSave: props.datasetToSave,
      initialColumns,
    });
    resetSlugInfo();
    return cancelReset;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!props.open]);

  const trpc = datasetApi.useUtils();

  const performUpsert = (data: DatasetRecordForm) => {
    upsertDataset.mutate(
      upsertInputOf({ projectId: project?.id ?? "", datasetToSave: props.datasetToSave, data }),
      {
        onSuccess: (data: WireOf<DatasetApiUpsertOutput>) => {
          props.onSuccess?.({
            datasetId: data.id,
            name: data.name,
            columnTypes: data.columnTypes as DatasetColumns,
          });
          toaster.create({
            title: datasetSavedTitle(props.datasetToSave),
            description: `Successfully ${props.datasetToSave?.datasetId ? "updated" : "created"} ${data.name} dataset`,
            type: "success",
          });
          reset();
          onClose();
          // Refetch the datasets to get the latest data
          void trpc.dataset.getAll.invalidate();
        },
        onError: (error: unknown) => {
          // A taken name is a complaint about the field the user is looking
          // at, so it belongs under that field rather than in a toast they
          // have to translate back into an edit. `applyHandledErrorToForm`
          // only claims `validation_error`, so this code is placed by hand.
          if (readHandledError(error)?.code === "dataset_name_taken") {
            setError(
              "name",
              { type: "server", message: describeError({ error }) },
              { shouldFocus: true },
            );
            return;
          }
          showErrorToast({
            error,
            fallbackTitle: `Couldn't ${props.datasetToSave?.datasetId ? "update" : "create"} the dataset`,
          });
        },
      },
    );
  };

  const onSubmit = (data: DatasetRecordForm) => {
    // For localOnly mode, skip DB save and just call onSuccess
    if (props.localOnly) {
      props.onSuccess?.({
        datasetId: props.datasetToSave?.datasetId ?? "",
        name: data.name,
        columnTypes: data.columnTypes,
      });
      reset();
      onClose();
      return;
    }

    performUpsert(data);
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={({ open }) => !open && onClose()} size="xl">
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack>
            <Drawer.Title>
              {datasetDrawerHeading({
                datasetToSave: props.datasetToSave,
                isEditing: Boolean(props.datasetToSave?.datasetId || props.localOnly),
              })}
            </Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what this group of examples is
              going to focus on"
              invalid={!!errors.name || (slugInfo?.hasConflict ?? false)}
            >
              <Input {...register("name")} data-testid="dataset-name-input" />
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
                          data-testid={`dataset-column-name-${index}`}
                        />
                        <NativeSelect.Root>
                          <NativeSelect.Field {...register(`columnTypes.${index}.type`)}>
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="date">date</option>
                            <option value="list">list</option>
                            <option value="json">json</option>
                            <option value="image">image</option>
                            <option value="file">file</option>
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
                            color={isHidden ? "fg.subtle" : "fg.muted"}
                            aria-label={isHidden ? "Show column" : "Hide column"}
                            title={isHidden ? "Show column" : "Hide column"}
                          >
                            {isHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                          </IconButton>
                        )}
                        {!props.isColumnsLocked && (
                          <Button
                            type="button"
                            size="sm"
                            aria-label="Remove column"
                            onClick={() => remove(index)}
                          >
                            <Trash2 size={32} />
                          </Button>
                        )}
                      </HStack>
                    );
                  })}
                  <Field.ErrorText>{errors.columnTypes?.message}</Field.ErrorText>
                  {!props.isColumnsLocked && (
                    <Button
                      type="button"
                      data-testid="dataset-column-add"
                      onClick={() => append({ name: "", type: "string" })}
                    >
                      Add Column
                    </Button>
                  )}
                </VStack>
              </VStack>
            </HorizontalFormControl>
            <Button
              colorPalette="blue"
              type="submit"
              data-testid="dataset-form-submit"
              minWidth="fit-content"
              loading={upsertDataset.isPending}
            >
              {datasetSubmitLabel({
                datasetToSave: props.datasetToSave,
                localOnly: Boolean(props.localOnly),
              })}
            </Button>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
