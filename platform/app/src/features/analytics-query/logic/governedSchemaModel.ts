/**
 * The governed schema, shaped for the browser and the editor's assistance.
 *
 * A projection of the schema response and nothing else. No dataset name, column
 * name, physical table or type is written here: everything the workbench offers
 * came back from the endpoint for *this* member, which is what makes the
 * surface tell the truth about what they may query. A hard-coded list would
 * survive a permission change, a catalog change and a deployment that publishes
 * fewer datasets — three ways to promise access the validator then refuses.
 *
 * Pure and DOM-free on purpose: the same functions feed the React tree and the
 * Monaco providers, and both are covered without rendering anything.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import type {
  GovernedSchema,
  GovernedSchemaColumn,
  GovernedSchemaDataset,
} from "~/server/analytics/governed-sql";

/** One column, as the browser and the completion list read it. */
export interface GovernedSchemaColumnModel {
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

/** One dataset, with everything the browser shows when it is expanded. */
export interface GovernedSchemaDatasetModel {
  readonly name: string;
  readonly description: string;
  readonly grain: string;
  readonly joinKeys: readonly string[];
  readonly timeColumn: string;
  readonly freshness: string;
  readonly exampleSql: string;
  readonly columns: readonly GovernedSchemaColumnModel[];
}

/** The whole schema, as one member sees it. */
export interface GovernedSchemaModel {
  readonly database: string;
  readonly datasets: readonly GovernedSchemaDatasetModel[];
}

/** An empty model — what an unanswered schema query renders. */
export const EMPTY_GOVERNED_SCHEMA_MODEL: GovernedSchemaModel = {
  database: "",
  datasets: [],
};

function columnModel({
  dataset,
  column,
}: {
  dataset: GovernedSchemaDataset;
  column: GovernedSchemaColumn;
}): GovernedSchemaColumnModel {
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
 * Maps a schema response onto the model the workbench renders.
 *
 * Total over the response: every dataset it carries becomes a dataset, every
 * column a column, in the order they arrived. Nothing is added and nothing is
 * dropped, so a diff between the response and the surface is a bug in one of
 * them rather than a policy this file quietly applies.
 */
export function governedSchemaModel(
  schema: GovernedSchema | undefined,
): GovernedSchemaModel {
  if (!schema) return EMPTY_GOVERNED_SCHEMA_MODEL;

  return {
    database: schema.database,
    datasets: schema.datasets.map((dataset) => ({
      name: dataset.name,
      description: dataset.description,
      grain: dataset.grain,
      joinKeys: dataset.joinKeys,
      timeColumn: dataset.timeColumn,
      freshness: dataset.freshness,
      exampleSql: dataset.exampleSql,
      columns: dataset.columns.map((column) =>
        columnModel({ dataset, column }),
      ),
    })),
  };
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * The model narrowed to what a search term names.
 *
 * A dataset whose own name or description matches keeps all of its columns —
 * the member asked for the dataset, not for part of it. A dataset that matches
 * only through its columns keeps just those columns, so the result reads as an
 * answer rather than as the whole schema with one row highlighted.
 */
export function filterGovernedSchemaModel({
  model,
  search,
}: {
  model: GovernedSchemaModel;
  search: string;
}): GovernedSchemaModel {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return model;

  const datasets: GovernedSchemaDatasetModel[] = [];
  for (const dataset of model.datasets) {
    if (matches(dataset.name, needle) || matches(dataset.description, needle)) {
      datasets.push(dataset);
      continue;
    }
    const columns = dataset.columns.filter(
      (column) =>
        matches(column.name, needle) || matches(column.description, needle),
    );
    if (columns.length > 0) datasets.push({ ...dataset, columns });
  }

  return { database: model.database, datasets };
}

/** What kind of governed identifier a suggestion names. */
export type GovernedSqlCompletionKind = "dataset" | "column";

/** One entry of the editor's completion list. */
export interface GovernedSqlCompletionItem {
  readonly label: string;
  readonly kind: GovernedSqlCompletionKind;
  /** Written into the editor when the entry is accepted. */
  readonly insertText: string;
  /** The short right-hand annotation: a ClickHouse type, or the grain. */
  readonly detail: string;
  /** The long form, shown in the details pane and on hover. */
  readonly documentation: string;
}

function columnDocumentation(column: GovernedSchemaColumnModel): string {
  const unit = column.unit ? ` Measured in ${column.unit}.` : "";
  return `${column.description}${unit}`;
}

/**
 * Every completion the editor offers, derived from the response.
 *
 * Columns the response marks unavailable are left out: they are listed in the
 * browser so the member can see which permission would unlock them, but
 * suggesting one in the editor would be offering a name the validator refuses.
 */
export function governedSqlCompletionItems(
  model: GovernedSchemaModel,
): readonly GovernedSqlCompletionItem[] {
  const items: GovernedSqlCompletionItem[] = [];

  for (const dataset of model.datasets) {
    items.push({
      label: dataset.name,
      kind: "dataset",
      insertText: dataset.name,
      detail: dataset.grain,
      documentation: `${dataset.description}\n\nFreshness: ${dataset.freshness}\nTime column: ${dataset.timeColumn}`,
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

/** What the editor shows when the cursor rests on a governed identifier. */
export interface GovernedSqlHover {
  readonly title: string;
  readonly detail: string;
  readonly documentation: string;
}

/**
 * Hover copy for one identifier, or nothing when the schema does not name it.
 *
 * Matches a dataset by its qualified name or by its bare name, and a column by
 * its bare name or its `<dataset>.<column>` form — the three spellings a member
 * actually writes. An unavailable column resolves to nothing, for the same
 * reason it is never suggested.
 */
export function governedSqlHoverFor({
  model,
  identifier,
}: {
  model: GovernedSchemaModel;
  identifier: string;
}): GovernedSqlHover | undefined {
  const wanted = identifier.trim().toLowerCase();
  if (wanted.length === 0) return undefined;

  return hoverForDataset(model, wanted) ?? hoverForColumn(model, wanted);
}

/** The dataset a member named, qualified or bare. */
function hoverForDataset(
  model: GovernedSchemaModel,
  wanted: string,
): GovernedSqlHover | undefined {
  const dataset = model.datasets.find((candidate) =>
    datasetSpellings(candidate).includes(wanted),
  );
  if (!dataset) return undefined;

  return {
    title: dataset.name,
    detail: dataset.grain,
    documentation: `${dataset.description}\n\nFreshness: ${dataset.freshness}\nTime column: ${dataset.timeColumn}`,
  };
}

function datasetSpellings(dataset: GovernedSchemaDatasetModel): string[] {
  const bare = dataset.name.split(".").at(-1) ?? dataset.name;
  return [dataset.name.toLowerCase(), bare.toLowerCase()];
}

/** The column a member named, bare or qualified. Withheld columns answer nothing. */
function hoverForColumn(
  model: GovernedSchemaModel,
  wanted: string,
): GovernedSqlHover | undefined {
  const column = model.datasets
    .flatMap((dataset) => dataset.columns)
    .find(
      (candidate) =>
        candidate.available &&
        (candidate.name.toLowerCase() === wanted ||
          candidate.qualifiedName.toLowerCase() === wanted),
    );
  if (!column) return undefined;

  return {
    title: column.qualifiedName,
    detail: column.type,
    documentation: columnDocumentation(column),
  };
}
