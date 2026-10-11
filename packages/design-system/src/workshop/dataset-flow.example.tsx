import { Banner } from "@langwatch/design-system/banner";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Drawer } from "@langwatch/design-system/drawer";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListPage, type ListPageState } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { EmptyNextSteps } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import { SettingsField, SettingsFieldGroup } from "@langwatch/design-system/settings-field";
import { slugify } from "@langwatch/design-system/slugify";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
} from "react";

/** One column definition of a dataset. */
export type ColumnType = "string" | "number" | "boolean" | "list" | "json";
export interface Column {
  name: string;
  type: ColumnType;
}

/** One row of the list. Integer ids and fixed dates keep the example deterministic. */
export interface Dataset {
  id: number;
  name: string;
  columns: Column[];
  entries: number;
  updated: string;
}

/** What the drawer form edits. `datasetId` is set when it edits an existing dataset. */
export interface Draft {
  datasetId?: number;
  name: string;
  columns: Column[];
}

/** Your API's save. It resolves when the dataset is stored and rejects with a readable message. */
export type SaveDataset = (draft: Draft) => Promise<void>;

interface Problems {
  name?: string;
  columns?: string;
}

interface FormState extends Draft {
  mode: "create" | "edit";
  problems: Problems;
  pending: boolean;
  /** A refusal that is still true of the whole form, shown above the fields. */
  failure?: string;
}

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface DatasetFlowStart {
  datasets?: Dataset[];
  loading?: boolean;
  query?: string;
  form?: Partial<FormState>;
  /** Opens the delete confirmation for this dataset id. */
  confirmDelete?: number;
  /** Starts with this dataset id already deleted and its Undo notice showing. */
  deleted?: number;
}

const TODAY = "11 Oct 2026";
const DOCS = "https://docs.langwatch.ai/datasets/overview";
/** How long the delete notice, and so the Undo, stays up. The dataset screen uses the same. */
const DELETE_NOTICE_MS = 10_000;
const COLUMN_TYPES: ColumnType[] = ["string", "number", "boolean", "list", "json"];

export const SEED_DATASETS: Dataset[] = [
  {
    id: 1,
    name: "Refund questions",
    columns: [
      { name: "question", type: "string" },
      { name: "expected_answer", type: "string" },
    ],
    entries: 42,
    updated: "9 Oct 2026",
  },
  {
    id: 2,
    name: "Delivery questions",
    columns: [
      { name: "question", type: "string" },
      { name: "expected_answer", type: "string" },
      { name: "carrier", type: "string" },
    ],
    entries: 128,
    updated: "10 Oct 2026",
  },
];

const NEW_COLUMNS: Column[] = [
  { name: "question", type: "string" },
  { name: "expected_answer", type: "string" },
];

/** A stand-in for your API: succeeds straight away. Pass your own to call a real one. */
const saveLocally: SaveDataset = () => Promise.resolve();

function isTaken({ name, others }: { name: string; others: Dataset[] }): boolean {
  const wanted = name.toLowerCase();
  return others.some((other) => other.name.toLowerCase() === wanted);
}

function duplicateColumn(columns: Column[]): string | undefined {
  const names = columns.map((column) => column.name);
  return names.find((name, index) => names.indexOf(name) !== index);
}

function describeProblems({ draft, others }: { draft: Draft; others: Dataset[] }): Problems {
  const problems: Problems = {};
  const name = draft.name.trim();
  if (name === "") problems.name = "Name is required";
  else if (isTaken({ name, others })) problems.name = "That name is already taken";
  const repeated = duplicateColumn(draft.columns);
  if (draft.columns.some((column) => column.name.trim() === "")) {
    problems.columns = "Column name cannot be empty";
  } else if (repeated !== undefined) {
    problems.columns = `Two columns are called "${repeated}". Column names must be unique.`;
  }
  return problems;
}

/** The first column input that has something wrong, so focus can go to it. */
function firstProblemColumn(columns: Column[]): number {
  const repeated = duplicateColumn(columns);
  const at = columns.findIndex((column) => column.name.trim() === "" || column.name === repeated);
  return Math.max(at, 0);
}

function saveInto({
  datasets,
  draft,
  newId,
}: {
  datasets: Dataset[];
  draft: Draft;
  newId: number;
}): Dataset[] {
  const name = draft.name.trim();
  if (draft.datasetId === undefined) {
    return [...datasets, { id: newId, name, columns: draft.columns, entries: 0, updated: TODAY }];
  }
  return datasets.map((dataset) =>
    dataset.id === draft.datasetId
      ? { ...dataset, name, columns: draft.columns, updated: TODAY }
      : dataset,
  );
}

/** Whether your API took the dataset: undefined when it did, the reason when it did not. */
async function refusalOf({
  save,
  draft,
}: {
  save: SaveDataset;
  draft: Draft;
}): Promise<string | undefined> {
  try {
    await save(draft);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "The dataset could not be saved.";
  }
}

function listStateOf({
  loading,
  total,
  shown,
}: {
  loading: boolean;
  total: number;
  shown: number;
}): Exclude<ListPageState, "error"> {
  if (loading) return "loading";
  if (total === 0) return "empty";
  return shown === 0 ? "no-results" : "ready";
}

function agentPrompt({ name }: { name: string }): string {
  return `Create a LangWatch dataset called "${name}" with the columns question and expected_answer, then add ten example rows taken from our support conversations.`;
}

/** Where focus goes when an overlay closes: New dataset, or the opener of a dataset's row. */
type FocusTarget = "new" | number;

type SetDatasets = Dispatch<SetStateAction<Dataset[]>>;

function announceDeletion({
  dataset,
  index,
  setDatasets,
  setFocusRow,
}: {
  dataset: Dataset;
  index: number;
  setDatasets: SetDatasets;
  setFocusRow: (target: FocusTarget) => void;
}) {
  toaster.create({
    id: `delete-dataset-${dataset.id}`,
    type: "success",
    title: `Dataset ${dataset.name} deleted`,
    duration: DELETE_NOTICE_MS,
    action: {
      label: "Undo",
      onClick: () => {
        setDatasets((current) => current.toSpliced(Math.min(index, current.length), 0, dataset));
        setFocusRow(dataset.id);
        toaster.create({
          type: "success",
          title: "Dataset restored",
          description: `${dataset.name} is back in the list.`,
        });
      },
    },
  });
}

/**
 * Datasets list, create and edit in a Drawer, delete behind a ConfirmDialog, and a notice
 * with Undo. The application owns `save`, navigation and the real data; this owns the shapes.
 */
export function DatasetFlow({
  save = saveLocally,
  start = {},
}: {
  save?: SaveDataset;
  start?: DatasetFlowStart;
}) {
  const [datasets, setDatasets] = useState<Dataset[]>(() =>
    (start.datasets ?? SEED_DATASETS).filter((dataset) => dataset.id !== start.deleted),
  );
  const [query, setQuery] = useState(start.query ?? "");
  const [form, setForm] = useState<FormState | undefined>(() =>
    start.form
      ? {
          mode: "create",
          name: "",
          columns: NEW_COLUMNS,
          problems: {},
          pending: false,
          ...start.form,
        }
      : undefined,
  );
  const [formOpen, setFormOpen] = useState(start.form !== undefined);
  const [toDelete, setToDelete] = useState<Dataset | undefined>(() =>
    SEED_DATASETS.find((dataset) => dataset.id === start.confirmDelete),
  );
  const [deleteOpen, setDeleteOpen] = useState(start.confirmDelete !== undefined);
  const [focusRow, setFocusRow] = useState<FocusTarget>();
  const [opener, setOpener] = useState<FocusTarget>("new");
  const afterDelete = useRef<FocusTarget>(start.confirmDelete ?? "new");
  const nextId = useRef(Math.max(0, ...SEED_DATASETS.map((dataset) => dataset.id)) + 1);
  const newButton = useRef<HTMLButtonElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const columnInputs = useRef<(HTMLInputElement | null)[]>([]);

  const visible = datasets.filter((dataset) =>
    dataset.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const elementFor = (target: FocusTarget) =>
    target === "new"
      ? newButton.current
      : table.current?.querySelector<HTMLElement>(`[data-dataset-id="${target}"] button`);

  /** Undo has no dialog to hand focus back: once the restored row is drawn, focus it. */
  useEffect(() => {
    if (focusRow === undefined) return;
    const frame = requestAnimationFrame(() => {
      elementFor(focusRow)?.focus();
      setFocusRow(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRow]);

  useEffect(() => {
    const dataset = SEED_DATASETS.find((seeded) => seeded.id === start.deleted);
    if (!dataset) return;
    announceDeletion({ dataset, index: SEED_DATASETS.indexOf(dataset), setDatasets, setFocusRow });
  }, [start.deleted]);

  const patch = (change: Partial<FormState>) =>
    setForm((current) => (current ? { ...current, ...change } : current));

  const openCreate = () => {
    setOpener("new");
    setForm({ mode: "create", name: "", columns: NEW_COLUMNS, problems: {}, pending: false });
    setFormOpen(true);
  };

  const openEdit = (dataset: Dataset) => {
    const { id: datasetId, name, columns } = dataset;
    setOpener(datasetId);
    setForm({ mode: "edit", datasetId, name, columns, problems: {}, pending: false });
    setFormOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const others = datasets.filter((dataset) => dataset.id !== form.datasetId);
    const problems = describeProblems({ draft: form, others });
    patch({ problems, failure: undefined });
    if (problems.name) return nameInput.current?.focus();
    if (problems.columns) return columnInputs.current[firstProblemColumn(form.columns)]?.focus();

    patch({ pending: true });
    const failure = await refusalOf({ save, draft: form });
    if (failure) return patch({ pending: false, failure });

    const newId = nextId.current++;
    setDatasets((current) => saveInto({ datasets: current, draft: form, newId }));
    patch({ pending: false });
    setFormOpen(false);
    toaster.create({
      type: "success",
      title: form.datasetId === undefined ? "Dataset created" : "Dataset updated",
      description: form.name.trim(),
    });
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    const index = datasets.findIndex((dataset) => dataset.id === toDelete.id);
    const neighbour = datasets[index + 1] ?? datasets[index - 1];
    setDatasets((current) => current.filter((dataset) => dataset.id !== toDelete.id));
    afterDelete.current = neighbour?.id ?? "new";
    setDeleteOpen(false);
    announceDeletion({ dataset: toDelete, index, setDatasets, setFocusRow });
  };

  return (
    <ProductScope product="llm-ops">
      <ListPage
        title="Datasets"
        description="Examples your prompts and agents are evaluated against."
        actions={
          <PageLayout.HeaderButton primary ref={newButton} onClick={openCreate}>
            New dataset
          </PageLayout.HeaderButton>
        }
        state={listStateOf({
          loading: start.loading === true,
          total: datasets.length,
          shown: visible.length,
        })}
        toolbar={{
          search: {
            value: query,
            onChange: setQuery,
            placeholder: "Search datasets",
            ariaLabel: "Search datasets",
          },
          summary: `${visible.length} of ${datasets.length} datasets`,
        }}
        empty={{
          title: "No datasets yet",
          description:
            "Datasets hold the examples you evaluate a prompt or an agent against. Create one here or let your coding agent set it up.",
          icon: <ColumnTypeIcon type="list" size={24} />,
          next: [
            { kind: "docs", label: "Read about datasets", href: DOCS },
            { kind: "agent-prompt", prompt: agentPrompt({ name: "Refund questions" }) },
          ],
        }}
        noResults={{
          description: `No dataset is called "${query}".`,
          onClear: () => setQuery(""),
          next: [{ kind: "agent-prompt", prompt: agentPrompt({ name: query.trim() }) }],
        }}
      >
        <Box ref={table}>
          <DatasetTable
            rows={visible}
            onOpen={openEdit}
            onDelete={(dataset) => {
              setToDelete(dataset);
              afterDelete.current = dataset.id;
              setDeleteOpen(true);
            }}
          />
        </Box>
      </ListPage>

      {form && (
        <DatasetDrawer
          form={form}
          open={formOpen}
          onChange={patch}
          onClose={() => setFormOpen(false)}
          onSubmit={submit}
          nameInput={nameInput}
          columnInputs={columnInputs}
          onExitComplete={() => elementFor(opener)?.focus()}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        finalFocusEl={() => elementFor(afterDelete.current) ?? null}
        onExitComplete={() => setToDelete(undefined)}
        title="Delete dataset?"
        description={`"${toDelete?.name ?? "This dataset"}" and its ${toDelete?.entries ?? 0} entries leave the list. You can undo this for ten seconds.`}
        confirmLabel="Delete dataset"
        tone="danger"
        onConfirm={confirmDelete}
      />

      <Toaster />
    </ProductScope>
  );
}

function DatasetTable({
  rows,
  onOpen,
  onDelete,
}: {
  rows: Dataset[];
  onOpen: (dataset: Dataset) => void;
  onDelete: (dataset: Dataset) => void;
}) {
  return (
    <ListTable aria-label="Datasets" scroll="x" scrollLabel="Datasets" minWidth="40rem">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Columns</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Entries</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last updated</ListTable.ColumnHeader>
          <ListTable.ActionHeader label="Dataset actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((dataset) => (
          <DatasetRow key={dataset.id} dataset={dataset} onOpen={onOpen} onDelete={onDelete} />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

function DatasetRow({
  dataset,
  onOpen,
  onDelete,
}: {
  dataset: Dataset;
  onOpen: (dataset: Dataset) => void;
  onDelete: (dataset: Dataset) => void;
}) {
  const hidden = dataset.columns.length - 3;
  return (
    <ListTable.Row data-dataset-id={dataset.id} onActivate={() => onOpen(dataset)}>
      <ListTable.Cell>
        <ListTable.RowAction onActivate={() => onOpen(dataset)}>{dataset.name}</ListTable.RowAction>
      </ListTable.Cell>
      <ListTable.Cell>
        <HStack gap={1} wrap="wrap">
          {dataset.columns.slice(0, 3).map((column) => (
            <InlineCode key={column.name} variant="neutral">
              {column.name}
            </InlineCode>
          ))}
          {hidden > 0 && (
            <Text as="span" textStyle="xs" color="fg.muted">
              +{hidden}
            </Text>
          )}
        </HStack>
      </ListTable.Cell>
      <ListTable.Cell numeric>{dataset.entries}</ListTable.Cell>
      <ListTable.Cell tone="muted">{dataset.updated}</ListTable.Cell>
      <ListTable.ActionCell>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="xs" variant="ghost" aria-label={`Actions for ${dataset.name}`}>
              <MoreVerticalIcon size={16} aria-hidden />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="edit" onClick={() => onOpen(dataset)}>
              Edit
            </Menu.Item>
            <Menu.Item value="delete" color="fg.error" onClick={() => onDelete(dataset)}>
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

function DatasetDrawer({
  form,
  open,
  onChange,
  onClose,
  onSubmit,
  nameInput,
  columnInputs,
  onExitComplete,
}: {
  form: FormState;
  open: boolean;
  onChange: (change: Partial<FormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  nameInput: RefObject<HTMLInputElement | null>;
  columnInputs: RefObject<(HTMLInputElement | null)[]>;
  onExitComplete: () => void;
}) {
  const slug = slugify(form.name);
  const setColumn = ({ index, change }: { index: number; change: Partial<Column> }) =>
    onChange({
      columns: form.columns.map((column, at) => (at === index ? { ...column, ...change } : column)),
    });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={form.mode === "create" ? "New dataset" : "Edit dataset"}
      size="lg"
      busy={form.pending}
      onSubmit={onSubmit}
      initialFocusEl={() => nameInput.current}
      onExitComplete={onExitComplete}
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: form.mode === "create" ? "Create dataset" : "Save changes",
          type: "submit",
          loading: form.pending,
        },
      }}
    >
      <Stack gap={5}>
        {form.failure && (
          <Banner
            status="error"
            placement="inline"
            title="Couldn't save the dataset"
            action={
              <EmptyNextSteps
                next={[{ kind: "docs", label: "Dataset troubleshooting", href: DOCS }]}
              />
            }
          >
            {form.failure} Your changes are still here: save again to retry.
          </Banner>
        )}
        <SettingsFieldGroup>
          <SettingsField
            label="Name"
            hint="What this group of examples is going to focus on."
            error={form.problems.name}
            disabled={form.pending}
          >
            <Input
              ref={nameInput}
              value={form.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            <Text textStyle="xs" color="fg.muted" marginTop={1}>
              {slug ? (
                <>
                  Slug <InlineCode>{slug}</InlineCode>
                </>
              ) : (
                "The slug is made from the name."
              )}
            </Text>
          </SettingsField>
          <SettingsField
            label="Columns"
            hint="The columns each row of the dataset carries."
            error={form.problems.columns}
            disabled={form.pending}
          >
            <Stack gap={2} width="full">
              {form.columns.map((column, index) => (
                <ColumnRow
                  key={index}
                  index={index}
                  column={column}
                  pending={form.pending}
                  inputRef={(element) => {
                    columnInputs.current[index] = element;
                  }}
                  onChange={(change) => setColumn({ index, change })}
                  onRemove={() =>
                    onChange({ columns: form.columns.filter((_, at) => at !== index) })
                  }
                />
              ))}
              <Box>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={form.pending}
                  onClick={() =>
                    onChange({ columns: [...form.columns, { name: "", type: "string" }] })
                  }
                >
                  Add column
                </Button>
              </Box>
            </Stack>
          </SettingsField>
        </SettingsFieldGroup>
      </Stack>
    </Drawer>
  );
}

function ColumnRow({
  index,
  column,
  pending,
  inputRef,
  onChange,
  onRemove,
}: {
  index: number;
  column: Column;
  pending: boolean;
  inputRef: (element: HTMLInputElement | null) => void;
  onChange: (change: Partial<Column>) => void;
  onRemove: () => void;
}) {
  return (
    <HStack gap={2} width="full">
      <ColumnTypeIcon type={column.type} />
      <Input
        ref={inputRef}
        id={`dataset-column-${index}-name`}
        value={column.name}
        placeholder="Column name"
        aria-label={`Column ${index + 1} name`}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <NativeSelect.Root width={{ base: "6.5rem", md: "9rem" }} flexShrink={0}>
        <NativeSelect.Field
          id={`dataset-column-${index}-type`}
          value={column.type}
          aria-label={`Column ${index + 1} type`}
          onChange={(event) => {
            const type = COLUMN_TYPES.find((known) => known === event.target.value);
            if (type) onChange({ type });
          }}
        >
          {COLUMN_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={pending}
        aria-label={`Remove column ${index + 1}`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </HStack>
  );
}
