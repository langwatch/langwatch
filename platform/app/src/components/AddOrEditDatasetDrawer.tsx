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
import type {
  Control,
  FieldArrayWithId,
  Resolver,
  UseFormRegister,
  UseFormReset,
  UseFormSetError,
} from "react-hook-form";
import {
  type FieldErrors,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import type { InMemoryDataset } from "~/components/datasets/editor/DatasetEditorTable";
import {
  describeError,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "../components/ui/drawer";
import { toaster } from "../components/ui/toaster";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { tryToMapPreviousColumnsToNewColumns } from "../optimization_studio/utils/datasetUtils";
import {
  type DatasetColumns,
  type DatasetRecordForm,
  type DatasetRecordInput,
  datasetRecordFormSchema,
} from "../server/datasets/types";
import { api } from "../utils/api";
import { DatasetSlugDisplay } from "./datasets/DatasetSlugDisplay";
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
 * The form rules the schema does not carry: a name is required, and a column
 * name is neither empty nor a repeat of another one.
 */
const resolveDatasetForm: Resolver<FormValues> = async (
  data,
  context,
  options,
) => {
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
};

/** How the drawer offers to hide a column without changing the dataset. */
type ColumnVisibility = {
  hiddenColumns: Set<string>;
  onToggleVisibility: (columnName: string) => void;
};

/** The name of the dataset, with the slug it gives under it. */
function DatasetNameField({
  register,
  errorMessage,
  slug,
}: {
  register: UseFormRegister<FormValues>;
  errorMessage?: string;
  slug: DatasetSlugState;
}) {
  return (
    <HorizontalFormControl
      label="Name"
      helper="Give it a name that identifies what this group of examples is
              going to focus on"
      invalid={!!errorMessage || (slug.slugInfo?.hasConflict ?? false)}
    >
      <Input {...register("name")} />
      <DatasetSlugDisplay
        marginLeft={1}
        marginTop={1}
        displaySlug={slug.displaySlug}
        slugWillChange={slug.slugWillChange}
        dbSlug={slug.dbSlug}
        slugInfo={slug.slugInfo}
      />
      <Field.ErrorText>{errorMessage}</Field.ErrorText>
    </HorizontalFormControl>
  );
}

/** The editable list of columns, with Add Column under it. */
function DatasetColumnsField({
  control,
  register,
  fields,
  errorMessage,
  isColumnsLocked,
  columnVisibility,
  onAdd,
  onRemove,
}: {
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  fields: Array<FieldArrayWithId<FormValues, "columnTypes", "id">>;
  errorMessage?: string;
  isColumnsLocked?: boolean;
  columnVisibility?: ColumnVisibility;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <VStack align="start">
      <VStack align="start" width="full">
        {fields.map((field, index) => (
          <DatasetColumnRow
            key={field.id}
            control={control}
            register={register}
            index={index}
            isColumnsLocked={isColumnsLocked}
            columnVisibility={columnVisibility}
            onRemove={onRemove}
          />
        ))}
        <Field.ErrorText>{errorMessage}</Field.ErrorText>
        {!isColumnsLocked && (
          <Button type="button" onClick={onAdd}>
            Add Column
          </Button>
        )}
      </VStack>
    </VStack>
  );
}

/** One column: its name, its type, and the actions the drawer offers on it. */
function DatasetColumnRow({
  control,
  register,
  index,
  isColumnsLocked,
  columnVisibility,
  onRemove,
}: {
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  index: number;
  isColumnsLocked?: boolean;
  columnVisibility?: ColumnVisibility;
  onRemove: (index: number) => void;
}) {
  // `useWatch` rather than `form.watch`, so a rename redraws this row: a child
  // that reads the value through `watch` never re-renders on it.
  const columnName = useWatch({
    control,
    name: `columnTypes.${index}.name`,
  });
  const isHidden = columnVisibility?.hiddenColumns.has(columnName);

  return (
    <HStack width="full" gap={2}>
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
          <option value="image">image</option>
          <option value="file">file</option>
          <option value="chat_messages">
            json chat messages (OpenAI format)
          </option>
          <option value="spans">json spans</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {columnVisibility && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => columnVisibility.onToggleVisibility(columnName)}
          color={isHidden ? "fg.subtle" : "fg.muted"}
          aria-label={isHidden ? "Show column" : "Hide column"}
          title={isHidden ? "Show column" : "Hide column"}
        >
          {isHidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      )}
      {!isColumnsLocked && (
        <Button
          type="button"
          size="sm"
          aria-label="Remove column"
          onClick={() => onRemove(index)}
        >
          <Trash2 size={32} />
        </Button>
      )}
    </HStack>
  );
}

/**
 * Submits the drawer's form, and reports what happened.
 *
 * A taken name is a complaint about the field the user is looking at, so it
 * lands under that field rather than in a toast they have to translate back
 * into an edit. Every other refusal is a toast.
 */
function useSubmitDataset({
  props,
  reset,
  setError,
  onClose,
  upsertDataset,
}: {
  props: AddDatasetDrawerProps;
  reset: UseFormReset<FormValues>;
  setError: UseFormSetError<FormValues>;
  onClose: () => void;
  upsertDataset: ReturnType<typeof api.dataset.upsert.useMutation>;
}) {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useUtils();

  return (data: DatasetRecordForm) => {
    // An in-memory dataset is never written: the caller keeps the rows.
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
        onSuccess: (saved) => {
          props.onSuccess({
            datasetId: saved.id,
            name: saved.name,
            columnTypes: saved.columnTypes as DatasetColumns,
          });
          toaster.create({
            title: props.datasetToSave?.datasetId
              ? "Dataset Updated"
              : props.datasetToSave
                ? "Dataset Saved"
                : "Dataset Created",
            description: props.datasetToSave?.datasetId
              ? `Successfully updated ${saved.name} dataset`
              : `Successfully created ${saved.name} dataset`,
            type: "success",
          });
          reset();
          onClose();
          // Refetch the datasets to get the latest data
          void trpc.dataset.getAll.invalidate();
        },
        onError: (error) => {
          // `applyHandledErrorToForm` only claims `validation_error`, so this
          // code is placed by hand.
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
}

/** What the name gives: the slug shown, and whether it is taken or changing. */
type DatasetSlugState = ReturnType<typeof useDatasetDrawerForm>["slug"];

/**
 * The drawer's form: its fields, its column list and the slug the name gives.
 *
 * Reopening the drawer resets it to whatever it was opened on, so a second
 * open never shows the first one's edits.
 */
function useDatasetDrawerForm(props: AddDatasetDrawerProps) {
  const initialColumns = DATASET_DEFAULT_COLUMNS;
  const form = useForm<FormValues>({
    defaultValues: {
      name: props.datasetToSave?.name ?? "",
      columnTypes: props.datasetToSave?.columnTypes ?? initialColumns,
    },
    resolver: resolveDatasetForm,
  });
  const { control, reset, watch } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "columnTypes",
  });

  const name = watch("name");
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
          name: props.datasetToSave?.name ?? "",
          columnTypes: props.datasetToSave?.columnTypes ?? initialColumns,
        });
      }, 0);
    } else {
      reset({ name: "", columnTypes: initialColumns });
    }
    resetSlugInfo();
    return () => {
      if (resetTimeout) clearTimeout(resetTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!props.open]);

  return {
    ...form,
    fields,
    append,
    remove,
    slug: { slugInfo, displaySlug, slugWillChange, dbSlug },
  };
}

/**
 * This is a component that allows you to create a new dataset
 * or edit an existing one's columns.
 */
export function AddOrEditDatasetDrawer(props: AddDatasetDrawerProps) {
  const upsertDataset = api.dataset.upsert.useMutation();
  const { closeDrawer } = useDrawer();
  const onClose = props.onClose ?? closeDrawer;
  const isOpen = props.open ?? true;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
    control,
    fields,
    append,
    remove,
    slug,
  } = useDatasetDrawerForm(props);

  const onSubmit = useSubmitDataset({
    props,
    reset,
    setError,
    onClose,
    upsertDataset,
  });

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
    >
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
            <DatasetNameField
              register={register}
              errorMessage={errors.name?.message}
              slug={slug}
            />

            <HorizontalFormControl
              label="Columns"
              helper="Which columns should be present in the dataset"
              invalid={!!errors.columnTypes}
            >
              <DatasetColumnsField
                control={control}
                register={register}
                fields={fields}
                errorMessage={errors.columnTypes?.message}
                isColumnsLocked={props.isColumnsLocked}
                columnVisibility={props.columnVisibility}
                onAdd={() => append({ name: "", type: "string" })}
                onRemove={remove}
              />
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
      } else if (type === "image" || type === "file") {
        // Attachment cells hold a reference string (URL, data URL or an
        // /api/files/... reference), so the raw value passes through.
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
