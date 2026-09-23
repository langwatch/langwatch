/**
 * The LangWatchQL schema, shaped for the browser and editor's assistance -- a pure projection
 * of the schema response, nothing hard-coded, since a fixed list would survive a permission or
 * catalog change while promising access the validator then refuses.
 */

import type {
  LangWatchQLSchema,
  LangWatchQLSchemaColumn,
  LangWatchQLSchemaDataset,
} from "@langwatch/analytics-contract";

/** One column, as the browser and the completion list read it. */
export interface LangWatchQLSchemaColumnModel {
  readonly name: string;
  /** ClickHouse type, verbatim from the response. */
  readonly type: string;
  readonly description: string;
  /** What the values are measured in, or `null` when they are not measured. */
  readonly unit: string | null;
  /**
   * Whether this member may reference it. A column they may not stays listed —
   * the response lists it — but nothing about its values is ever shown.
   */
  readonly available: boolean;
  /** Permissions that would unlock it. Empty for an unrestricted column. */
  readonly gates: readonly string[];
  /** `<dataset>.<column>`, which is what an insert writes into the editor. */
  readonly qualifiedName: string;
}

/** The completion-item documentation for one dataset. */
function datasetDocumentation(dataset: {
  description: string;
  freshness: string;
  timeColumn: string | null;
}): string {
  const timeColumn = dataset.timeColumn ? `\nTime column: ${dataset.timeColumn}` : "";

  return `${dataset.description}\n\nFreshness: ${dataset.freshness}${timeColumn}`;
}

/** One dataset, with everything the browser shows when it is expanded. */
export interface LangWatchQLSchemaDatasetModel {
  readonly name: string;
  readonly description: string;
  readonly grain: string;
  readonly joinKeys: readonly string[];
  /** Filter on this to prune partitions; `null` for a dataset with no temporal column. */
  readonly timeColumn: string | null;
  readonly freshness: string;
  readonly exampleSql: string;
  readonly columns: readonly LangWatchQLSchemaColumnModel[];
}

/** The whole schema, as one member sees it. */
export interface LangWatchQLSchemaModel {
  readonly database: string;
  readonly datasets: readonly LangWatchQLSchemaDatasetModel[];
}

/** An empty model — what an unanswered schema query renders. */
export const EMPTY_LWQL_SCHEMA_MODEL: LangWatchQLSchemaModel = {
  database: "",
  datasets: [],
};

function columnModel({
  dataset,
  column,
}: {
  dataset: LangWatchQLSchemaDataset;
  column: LangWatchQLSchemaColumn;
}): LangWatchQLSchemaColumnModel {
  return {
    name: column.name,
    type: column.type,
    description: column.description,
    unit: column.unit,
    available: column.available,
    gates: column.gates,
    qualifiedName: `${dataset.name}.${column.name}`,
  };
}

/**
 * Maps a schema response onto the model the workbench renders -- total over the response: every
 * dataset and column becomes one, in arrival order. A diff from the response is a bug, not a
 * policy this file applies.
 */
export function lwqlSchemaModel(schema: LangWatchQLSchema | undefined): LangWatchQLSchemaModel {
  if (!schema) return EMPTY_LWQL_SCHEMA_MODEL;

  return {
    database: schema.database,
    datasets: schema.views.map((dataset) => ({
      name: dataset.name,
      description: dataset.description,
      grain: dataset.grain,
      joinKeys: dataset.joinKeys,
      timeColumn: dataset.timeColumn,
      freshness: dataset.freshness,
      exampleSql: dataset.exampleSql,
      columns: dataset.columns.map((column) => columnModel({ dataset, column })),
    })),
  };
}

function matches({ haystack, needle }: { haystack: string; needle: string }): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * The model narrowed to what a search term names. A dataset matching by name/description keeps
 * all its columns -- the member asked for the dataset. One matching only via columns keeps just
 * those, so the result reads as an answer, not the whole schema with one row highlighted.
 */
export function filterLangWatchQLSchemaModel({
  model,
  search,
}: {
  model: LangWatchQLSchemaModel;
  search: string;
}): LangWatchQLSchemaModel {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return model;

  const datasets: LangWatchQLSchemaDatasetModel[] = [];
  for (const dataset of model.datasets) {
    const datasetMatches =
      matches({ haystack: dataset.name, needle }) ||
      matches({ haystack: dataset.description, needle });
    if (datasetMatches) {
      datasets.push(dataset);
      continue;
    }
    const columns = dataset.columns.filter(
      (column) =>
        matches({ haystack: column.name, needle }) ||
        matches({ haystack: column.description, needle }),
    );
    if (columns.length > 0) datasets.push({ ...dataset, columns });
  }

  return { database: model.database, datasets };
}

/** What kind of LangWatchQL identifier a suggestion names. */
export type LangWatchQLCompletionKind = "dataset" | "column";

/** One entry of the editor's completion list. */
export interface LangWatchQLCompletionItem {
  readonly label: string;
  readonly kind: LangWatchQLCompletionKind;
  /** Written into the editor when the entry is accepted. */
  readonly insertText: string;
  /** The short right-hand annotation: a ClickHouse type, or the grain. */
  readonly detail: string;
  /** The long form, shown in the details pane and on hover. */
  readonly documentation: string;
}

function columnDocumentation(column: LangWatchQLSchemaColumnModel): string {
  const unit = column.unit ? ` Measured in ${column.unit}.` : "";
  return `${column.description}${unit}`;
}

/**
 * Every completion the editor offers, derived from the response. Columns marked unavailable are
 * left out: listed in the browser so a member sees which permission unlocks them, but suggesting
 * one in the editor would offer a name the validator refuses.
 */
export function lwqlCompletionItems(
  model: LangWatchQLSchemaModel,
): readonly LangWatchQLCompletionItem[] {
  const items: LangWatchQLCompletionItem[] = [];

  for (const dataset of model.datasets) {
    items.push({
      label: dataset.name,
      kind: "dataset",
      insertText: dataset.name,
      detail: dataset.grain,
      documentation: datasetDocumentation(dataset),
    });

    for (const column of dataset.columns) {
      if (!column.available) continue;
      items.push({
        label: column.name,
        kind: "column",
        insertText: column.name,
        detail: column.type,
        documentation: `${dataset.name}\n\n${columnDocumentation(column)}`,
      });
    }
  }

  return items;
}

/** What the editor shows when the cursor rests on a LangWatchQL identifier. */
export interface LangWatchQLHover {
  readonly title: string;
  readonly detail: string;
  readonly documentation: string;
}

/**
 * Hover copy for one identifier, or nothing when the schema does not name it. Matches a dataset
 * by qualified or bare name, a column by bare or `<dataset>.<column>` form -- the three spellings
 * a member writes. An unavailable column resolves to nothing, same as never suggested.
 */
export function lwqlHoverFor({
  model,
  identifier,
}: {
  model: LangWatchQLSchemaModel;
  identifier: string;
}): LangWatchQLHover | undefined {
  const wanted = identifier.trim().toLowerCase();
  if (wanted.length === 0) return void 0;

  return hoverForDataset({ model, wanted }) ?? hoverForColumn({ model, wanted });
}

/** The dataset a member named, qualified or bare. */
function hoverForDataset({
  model,
  wanted,
}: {
  model: LangWatchQLSchemaModel;
  wanted: string;
}): LangWatchQLHover | undefined {
  const dataset = model.datasets.find((candidate) => datasetSpellings(candidate).includes(wanted));
  if (!dataset) return void 0;

  return {
    title: dataset.name,
    detail: dataset.grain,
    documentation: datasetDocumentation(dataset),
  };
}

function datasetSpellings(dataset: LangWatchQLSchemaDatasetModel): string[] {
  const bare = dataset.name.split(".").at(-1) ?? dataset.name;
  return [dataset.name.toLowerCase(), bare.toLowerCase()];
}

/** The column a member named, bare or qualified. Withheld columns answer nothing. */
function hoverForColumn({
  model,
  wanted,
}: {
  model: LangWatchQLSchemaModel;
  wanted: string;
}): LangWatchQLHover | undefined {
  const column = model.datasets
    .flatMap((dataset) => dataset.columns)
    .find(
      (candidate) =>
        candidate.available &&
        (candidate.name.toLowerCase() === wanted ||
          candidate.qualifiedName.toLowerCase() === wanted),
    );
  if (!column) return void 0;

  return {
    title: column.qualifiedName,
    detail: column.type,
    documentation: columnDocumentation(column),
  };
}
