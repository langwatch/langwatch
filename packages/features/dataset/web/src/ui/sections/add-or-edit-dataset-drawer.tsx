/**
 * Creates a dataset, or edits an existing one's columns.
 *
 * A NARROWED family-local copy of
 * `platform/app/src/components/AddOrEditDatasetDrawer`, which the workbench, the
 * upload confirm step, the add-record drawer and the platform drawer registry
 * still render. Deletes-only forbids repointing those, so the platform copy
 * stays for them and this one travels with the two Datasets screens.
 *
 * WHAT DID NOT TRAVEL, because these screens never pass it:
 *
 * - `columnVisibility` and `isColumnsLocked`, the workbench's and the upload
 *   confirm step's props.
 * - The `datasetRecords` re-mapping branch, which is how a workflow draft
 *   carries its rows onto renamed columns. It reached
 *   `@langwatch/workflow-web`, and dropping it is what keeps this closure free
 *   of a web-to-web import for a path the Datasets pages cannot take: neither
 *   screen has records in hand when it opens this drawer.
 * - `useDrawer`, which supplied a default `onClose`. Both callers pass one, and
 *   the platform drawer registry is not something a package may reach.
 *
 * ONE SUBSTITUTION, deliberate: the platform drawer drives its form through
 * `react-hook-form` plus a `zodResolver`, neither of which this package depends
 * on. The rules that resolver added by hand — a required name, no blank column
 * name, no duplicate column name — are stated below as one `describeProblems`
 * function, which is a value a test can assert on rather than a resolver's side
 * effects.
 */

import { Button, Field, Heading, HStack, Input, NativeSelect, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  type DatasetColumns,
  type DatasetColumnType,
  datasetColumnTypeSchema,
} from "@langwatch/dataset-contract";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { datasetApi } from "../../behavior/dataset-api";
import { useDatasetSlugValidation } from "../../behavior/use-dataset-slug-validation";
import { useDatasetHost } from "../../model/dataset-host";
import { DatasetSlugDisplay } from "../blocks/dataset-slug-display";
import { LabelledField } from "../elements/labelled-field";

/**
 * Columns a freshly created dataset starts with, matching the trace fields a
 * record carries by default.
 */
export const DATASET_DEFAULT_COLUMNS: DatasetColumns = [
  { name: "trace_id", type: "string" },
  { name: "timestamp", type: "date" },
  { name: "input", type: "string" },
  { name: "output", type: "string" },
  { name: "contexts", type: "list" },
  { name: "total_cost", type: "number" },
  { name: "annotations", type: "string" },
];

/** The column vocabulary the picker offers, in the order the platform drawer did. */
const COLUMN_TYPE_LABELS: ReadonlyArray<[DatasetColumnType, string]> = [
  ["string", "string"],
  ["number", "number"],
  ["boolean", "boolean"],
  ["date", "date"],
  ["list", "list"],
  ["json", "json"],
  ["image", "image (URL)"],
  ["chat_messages", "json chat messages (OpenAI format)"],
  ["spans", "json spans"],
];

export type DatasetToSave = {
  datasetId?: string;
  name?: string;
  columnTypes: DatasetColumns;
};

/** What is wrong with the form as it stands. Empty means it may be submitted. */
export function describeProblems({
  name,
  columnTypes,
}: {
  name: string;
  columnTypes: DatasetColumns;
}): { name?: string; columnTypes?: string } {
  const problems: { name?: string; columnTypes?: string } = {};

  if (name.trim() === "") problems.name = "Name is required";

  const seen = new Set<string>();
  for (const column of columnTypes) {
    if (column.name.trim() === "") {
      problems.columnTypes = "Column name cannot be empty";
      break;
    }
    if (seen.has(column.name)) {
      problems.columnTypes = `Cannot have multiple columns with the same name: \`${column.name}\``;
    }
    seen.add(column.name);
  }

  return problems;
}

export function AddOrEditDatasetDrawer({
  open,
  onClose,
  onSuccess,
  datasetToSave,
  /** Skips the save and hands the form back, for an in-memory dataset. */
  localOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumns }) => void;
  datasetToSave?: DatasetToSave;
  localOnly?: boolean;
}) {
  const host = useDatasetHost();
  const project = host.project();
  const upsertDataset = datasetApi.dataset.upsert.useMutation();
  const utils = datasetApi.useUtils();

  const [name, setName] = useState(datasetToSave?.name ?? "");
  const [columnTypes, setColumnTypes] = useState<DatasetColumns>(
    datasetToSave?.columnTypes ?? DATASET_DEFAULT_COLUMNS,
  );
  const [problems, setProblems] = useState<{ name?: string; columnTypes?: string }>({});

  const { slugInfo, displaySlug, slugWillChange, dbSlug, resetSlugInfo } = useDatasetSlugValidation(
    {
      projectId: project?.id,
      name,
      datasetId: datasetToSave?.datasetId,
    },
  );

  // Reopening the drawer is what resets it: the caller decides between "edit
  // this dataset" and "create a new one" by what it passes, and a stale draft
  // from the previous open would silently answer for the new one.
  useEffect(() => {
    setName(datasetToSave?.name ?? "");
    setColumnTypes(datasetToSave?.columnTypes ?? DATASET_DEFAULT_COLUMNS);
    setProblems({});
    resetSlugInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the drawer opening is the reset, not every prop identity
  }, [open]);

  const isEditing = !!datasetToSave?.datasetId || localOnly;
  const heading = isEditing ? "Edit Dataset" : datasetToSave ? "Save Dataset" : "New Dataset";

  const submitLabel = localOnly ? "Apply" : datasetToSave ? "Save" : "Create Dataset";

  const submit = () => {
    const found = describeProblems({ name, columnTypes });
    setProblems(found);
    if (found.name ?? found.columnTypes) return;

    if (localOnly) {
      onSuccess({ datasetId: datasetToSave?.datasetId ?? "", name, columnTypes });
      onClose();
      return;
    }

    upsertDataset.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: datasetToSave?.datasetId,
        name,
        columnTypes,
      },
      {
        onSuccess: (saved) => {
          onSuccess({
            datasetId: saved.id,
            name: saved.name,
            columnTypes: saved.columnTypes,
          });
          host.succeeded({
            title: datasetToSave?.datasetId
              ? "Dataset Updated"
              : datasetToSave
                ? "Dataset Saved"
                : "Dataset Created",
            description: datasetToSave?.datasetId
              ? `Successfully updated ${saved.name} dataset`
              : `Successfully created ${saved.name} dataset`,
          });
          onClose();
          void utils.dataset.getAll.invalidate();
        },
        onError: (error) => {
          // A taken name is a complaint about the field the reader is looking
          // at, so it belongs under that field rather than in a notice they have
          // to translate back into an edit. The host resolves the copy, because
          // the wire message of a handled error is its code slug.
          if (isNameTaken(error)) {
            setProblems((current) => ({ ...current, name: "That name is already taken" }));
            return;
          }
          host.failed({
            error,
            fallbackTitle: datasetToSave?.datasetId
              ? "Couldn't update the dataset"
              : "Couldn't create the dataset",
          });
        },
      },
    );
  };

  const setColumn = (index: number, patch: Partial<DatasetColumns[number]>) =>
    setColumnTypes((current) =>
      current.map((column, at) => (at === index ? { ...column, ...patch } : column)),
    );

  return (
    <Drawer.Root open={open} onOpenChange={({ open: next }) => !next && onClose()} size="xl">
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack>
            <Heading>{heading}</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <form
            data-testid="dataset-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <LabelledField
              label="Name"
              helper="Give it a name that identifies what this group of examples is going to focus on"
              invalid={!!problems.name || (slugInfo?.hasConflict ?? false)}
            >
              <Input
                value={name}
                aria-label="Dataset name"
                onChange={(event) => setName(event.target.value)}
              />
              <DatasetSlugDisplay
                marginLeft={1}
                marginTop={1}
                displaySlug={displaySlug}
                slugWillChange={slugWillChange}
                dbSlug={dbSlug}
                slugInfo={slugInfo}
              />
              <Field.ErrorText>{problems.name}</Field.ErrorText>
            </LabelledField>

            <LabelledField
              label="Columns"
              helper="Which columns should be present in the dataset"
              invalid={!!problems.columnTypes}
            >
              <VStack align="start" width="full">
                {columnTypes.map((column, index) => (
                  <HStack key={index} width="full" gap={2}>
                    <Input
                      value={column.name}
                      placeholder="Column name"
                      aria-label={`Column ${index + 1} name`}
                      onChange={(event) => setColumn(index, { name: event.target.value })}
                    />
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={column.type}
                        aria-label={`Column ${index + 1} type`}
                        onChange={(event) =>
                          setColumn(index, {
                            type: datasetColumnTypeSchema.parse(event.target.value),
                          })
                        }
                      >
                        {COLUMN_TYPE_LABELS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                    <Button
                      type="button"
                      size="sm"
                      aria-label="Remove column"
                      onClick={() =>
                        setColumnTypes((current) => current.filter((_, at) => at !== index))
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </HStack>
                ))}
                <Field.ErrorText>{problems.columnTypes}</Field.ErrorText>
                <Button
                  type="button"
                  onClick={() =>
                    setColumnTypes((current) => [...current, { name: "", type: "string" }])
                  }
                >
                  Add Column
                </Button>
              </VStack>
            </LabelledField>

            <Button
              colorPalette="blue"
              type="submit"
              minWidth="fit-content"
              loading={upsertDataset.isPending}
            >
              {submitLabel}
            </Button>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** The code the dataset transport refuses a taken name with. */
export const DATASET_NAME_TAKEN_CODE = "dataset_name_taken";

/**
 * Whether the server refused because another dataset already holds the name.
 *
 * The wire message of a handled error IS its code slug, and the dataset
 * transport sets exactly this one for a name conflict
 * (`dataset.api.ts`'s `datasetErrorHandler`). Comparing the code is what the
 * platform drawer did through `readHandledError`; a screen may not import that
 * reader, and the equality below asks the same question of the same value.
 */
function isNameTaken(error: unknown): boolean {
  return (error as { message?: unknown } | null)?.message === DATASET_NAME_TAKEN_CODE;
}
