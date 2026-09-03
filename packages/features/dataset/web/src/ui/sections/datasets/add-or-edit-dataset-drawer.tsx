import {
  Button,
  Field,
  Heading,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Eye, EyeOff, Trash2 } from "react-feather";
import { type FieldErrors, useFieldArray, useForm } from "react-hook-form";
import type { InMemoryDataset } from "./editor/dataset-editor-table";
import { convertDatasetRecordsToColumnTypes } from "@langwatch/dataset-web";
import { describeError, readHandledError, showErrorToast } from "@langwatch/workflow-web/studio-host/errors";
import { useDrawer } from "@langwatch/workflow-web/studio-host/use-drawer";
import { Drawer } from "@langwatch/workflow-web/components/ui/drawer";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { tryToMapPreviousColumnsToNewColumns } from "@langwatch/workflow-web";
import {
  type DatasetColumns,
  type DatasetRecordForm,
  datasetRecordFormSchema,
} from "@langwatch/dataset-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { DatasetSlugDisplay } from "./dataset-slug-display";
import { useDatasetSlugValidation } from "../../../behavior/datasets/use-dataset-slug-validation";
import { HorizontalFormControl } from "@langwatch/workflow-web/components/HorizontalFormControl";

export interface AddDatasetDrawerProps {
  datasetToSave?: Omit<InMemoryDataset, "datasetRecords"> & {
    datasetId?: string;
    // IDs are optional for new records - backend generates them with nanoid()
    datasetRecords?: Array<{ id?: string } & Record<string, unknown>>;
  };
  open?: boolean;
  onClose?: () => void;
  /**
   * What the caller does with the dataset that was just written.
   *
   * OPTIONAL, BECAUSE THE DRAWER IS ALSO A REGISTERED ADDRESS. Every in-product
   * caller — the workbench, the upload confirm step, "Add to Dataset" — mounts
   * this drawer itself and hands one in. `?drawer.open=addOrEditDataset` has no
   * caller at all: `CurrentDrawer` spreads the parsed address, and a URL cannot
   * carry a function. A required callback made that open a crash on the FIRST
   * successful save, after the dataset had already been written.
   *
   * The drawers doc settles what the ending should be instead: a sub-flow
   * "NAVIGATES to it and returns", and the return leg is `onClose`, which
   * already falls back to the navigator's `closeDrawer`. So a bare-URL open
   * creates the dataset and closes, and only a caller that asked to be told is
   * told.
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
   * When true, the column SET is fixed: the user can rename columns and change
   * their types but cannot add or remove them. Used by the upload confirm step
   * (ADR-032 v19), where the columns come from the file's header and must stay
   * positionally aligned with what the normalize job parses — adding (no row
   * data to back an invented column) or removing a column is a post-create edit
   * on the dataset page via this same drawer.
   */
  isColumnsLocked?: boolean;
}

type FormValues = {
  name: string;
  columnTypes: DatasetColumns;
};

/** Columns a freshly created dataset starts with, matching the trace fields
 *  a record carries by default. */
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
export function AddOrEditDatasetDrawer(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const upsertDataset = api.dataset.upsert.useMutation();
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
    resolver: async (data, context, options) => {
      const result = await zodResolver(datasetRecordFormSchema)(data, context, options);

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

  // Use custom hook for slug validation against a name + datasetId
  const { slugInfo, displaySlug, slugWillChange, dbSlug, resetSlugInfo } =
    useDatasetSlugValidation({
      name,
      datasetId: props.datasetToSave?.datasetId,
    });

  useEffect(() => {
    let resetTimeout: ReturnType<typeof setTimeout> | undefined;
    if (props.datasetToSave) {
      resetTimeout = setTimeout(() => {
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
    return () => {
      if (resetTimeout) clearTimeout(resetTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!props.open]);

  const trpc = api.useUtils();

  const performUpsert = (data: DatasetRecordForm) => {
    upsertDataset.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: props.datasetToSave?.datasetId,
        name: data.name,
        columnTypes: data.columnTypes,
        ...(props.datasetToSave?.datasetRecords
          ? {
              datasetRecords: convertDatasetRecordsToColumnTypes(
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
          props.onSuccess?.({
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
          });
          reset();
          onClose();
          // Refetch the datasets to get the latest data
          void trpc.dataset.getAll.invalidate();
        },
        onError: (error) => {
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
            fallbackTitle: props.datasetToSave?.datasetId
              ? "Couldn't update the dataset"
              : "Couldn't create the dataset",
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
                    const isHidden =
                      props.columnVisibility?.hiddenColumns.has(columnName);
                    return (
                      <HStack key={field.id} width="full" gap={2}>
                        <Input
                          {...register(`columnTypes.${index}.name`, {
                            required: "Column name cannot be empty",
                          })}
                          placeholder="Column name"
                        />
                        <NativeSelect.Root>
                          <NativeSelect.Field {...register(`columnTypes.${index}.type`)}>
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
                            onClick={() =>
                              props.columnVisibility?.onToggleVisibility(columnName)
                            }
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
              minWidth="fit-content"
              loading={upsertDataset.isPending}
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
